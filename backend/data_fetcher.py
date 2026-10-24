
from datetime import date, timedelta

import pandas as pd
import requests


ACTUAL_URL = (
    "https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream"
)
FORECAST_URL = (
    "https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream"
)

REQUEST_TIMEOUT = 30


def _get_records(url, params):
    """Request Elexon data and return its records."""
    response = requests.get(
        url,
        params=params,
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    payload = response.json()

    # Support either a direct list or a response containing a data list.
    if isinstance(payload, dict):
        payload = payload.get("data", [])

    if not isinstance(payload, list):
        raise ValueError(f"Unexpected response format from {url}")

    return payload


def _validate_dates(start, end):
    """Validate ISO-format dates and chronological order."""
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "start and end must use YYYY-MM-DD format."
        ) from exc

    if start_date > end_date:
        raise ValueError("start must be on or before end.")

    return start_date, end_date


def fetch_actual(start, end):
    """
    Fetch half-hourly wind generation actuals for settlement dates.
    Returns columns: time, actual.
    """
    start_date, end_date = _validate_dates(start, end)

    params = {
        "fuelType": "WIND",
        "settlementDateFrom": start_date.isoformat(),
        "settlementDateTo": end_date.isoformat(),
    }

    records = _get_records(ACTUAL_URL, params)

    rows = [
        {
            "time": item.get("startTime"),
            "actual": item.get("generation"),
        }
        for item in records
        if item.get("startTime") is not None
    ]

    result = pd.DataFrame(rows, columns=["time", "actual"])

    if result.empty:
        return result

    result["time"] = pd.to_datetime(
        result["time"], utc=True, errors="coerce"
    )
    result["actual"] = pd.to_numeric(
        result["actual"], errors="coerce"
    )

    result = result.dropna(subset=["time", "actual"])
    result = result.drop_duplicates(subset=["time"], keep="last")
    result = result.sort_values("time").reset_index(drop=True)

    return result


def fetch_forecast(start, end):
    """
    Fetch historical wind forecast publications relevant to delivery dates.

    The publication query begins seven days before the delivery window
    to allow earlier eligible forecast versions to be considered.
    Results are filtered to the requested delivery timestamps.

    Returns columns: time, publishTime, forecast.
    """
    start_date, end_date = _validate_dates(start, end)

    publication_start = start_date - timedelta(days=7)

    params = {
        "publishDateTimeFrom": (
            f"{publication_start.isoformat()}T00:00:00Z"
        ),
        "publishDateTimeTo": (
            f"{end_date.isoformat()}T23:59:59Z"
        ),
    }

    records = _get_records(FORECAST_URL, params)

    rows = [
        {
            "time": item.get("startTime"),
            "publishTime": item.get("publishTime"),
            "forecast": item.get("generation"),
        }
        for item in records
        if item.get("startTime") is not None
        and item.get("publishTime") is not None
    ]

    result = pd.DataFrame(
        rows,
        columns=["time", "publishTime", "forecast"],
    )

    if result.empty:
        return result

    result["time"] = pd.to_datetime(
        result["time"], utc=True, errors="coerce"
    )
    result["publishTime"] = pd.to_datetime(
        result["publishTime"], utc=True, errors="coerce"
    )
    result["forecast"] = pd.to_numeric(
        result["forecast"], errors="coerce"
    )

    result = result.dropna(
        subset=["time", "publishTime", "forecast"]
    )

    # Restrict forecasts to target delivery timestamps in the requested
    # delivery-date window. Keep multiple publication versions so that
    # select_forecast can choose the latest eligible one.
    start_utc = pd.Timestamp(start_date, tz="UTC")
    end_exclusive_utc = pd.Timestamp(
        end_date + timedelta(days=1), tz="UTC"
    )

    result = result[
        (result["time"] >= start_utc)
        & (result["time"] < end_exclusive_utc)
    ]

    return result.sort_values(
        ["time", "publishTime"]
    ).reset_index(drop=True)
