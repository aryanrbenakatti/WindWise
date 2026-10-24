
import math

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from data_fetcher import fetch_actual, fetch_forecast
from forecast_selector import select_forecast


app = FastAPI(title="Wind Generation Forecast Monitor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def validate_dates(start, end):
    try:
        start_date = pd.Timestamp(start).date()
        end_date = pd.Timestamp(end).date()
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Dates must use YYYY-MM-DD format.",
        )

    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="Start date must be on or before end date.",
        )

    if (end_date - start_date).days > 30:
        raise HTTPException(
            status_code=400,
            detail="Select a maximum decision window of 31 calendar days.",
        )

    return start_date, end_date


def get_merged_data(start: str, end: str, horizon: int):
    if horizon < 0 or horizon > 48:
        raise HTTPException(
            status_code=400,
            detail="Forecast horizon must be between 0 and 48 hours.",
        )

    start_date, end_date = validate_dates(start, end)

    # A decision at the end of the selected date range may concern
    # delivery on a later calendar date.
    extra_days = math.ceil(horizon / 24)
    delivery_end = end_date + pd.Timedelta(days=extra_days)

    delivery_start_str = start_date.isoformat()
    delivery_end_str = delivery_end.isoformat()

    try:
        actual = fetch_actual(delivery_start_str, delivery_end_str)
        forecasts = fetch_forecast(
            delivery_start_str,
            delivery_end_str,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to retrieve Elexon data: {exc}",
        ) from exc

    columns = ["time", "actual", "forecast", "publishTime", "decisionTime"]

    if actual.empty:
        return pd.DataFrame(columns=columns)

    actual = actual.copy()
    actual["time"] = pd.to_datetime(actual["time"], utc=True)
    actual["actual"] = pd.to_numeric(actual["actual"], errors="coerce")
    actual = actual.dropna(subset=["time", "actual"])
    actual = actual.sort_values("time").set_index("time")

    actual_hourly = (
        actual["actual"]
        .resample("1h", origin="start_day", label="left", closed="left")
        .mean()
        .dropna()
        .rename("actual")
        .reset_index()
    )

    # A target interval is included when its derived decision timestamp
    # falls within the inclusive start/end decision dates.
    decision_start = pd.Timestamp(start_date, tz="UTC")
    decision_end_exclusive = pd.Timestamp(
        end_date + pd.Timedelta(days=1), tz="UTC"
    )

    target_decision_times = (
        actual_hourly["time"] - pd.Timedelta(hours=horizon)
    )

    in_decision_window = (
        (target_decision_times >= decision_start)
        & (target_decision_times < decision_end_exclusive)
    )

    actual_hourly = actual_hourly.loc[in_decision_window].copy()

    selected = select_forecast(actual_hourly, forecasts, horizon)

    merged = actual_hourly.merge(selected, on="time", how="left")
    merged["decisionTime"] = (
        merged["time"] - pd.Timedelta(hours=horizon)
    )

    # This should always be zero because the selector enforces this rule.
    matched = merged.dropna(subset=["forecast", "publishTime"])
    violations = (
        matched["publishTime"] > matched["decisionTime"]
    ).sum()

    if violations:
        raise HTTPException(
            status_code=500,
            detail="Internal validation failed: a selected forecast "
                   "was published after its decision cutoff.",
        )

    return merged.sort_values("time").reset_index(drop=True)


def json_safe_records(df):
    output = df.copy()

    for column in ["time", "publishTime", "decisionTime"]:
        if column in output.columns:
            output[column] = output[column].apply(
                lambda value: value.isoformat()
                if pd.notna(value)
                else None
            )

    output = output.replace({np.nan: None})
    return output.to_dict(orient="records")


@app.get("/wind-data")
def get_wind_data(start: str, end: str, horizon: int):
    return json_safe_records(get_merged_data(start, end, horizon))


@app.get("/wind-metrics")
def get_wind_metrics(start: str, end: str, horizon: int):
    merged = get_merged_data(start, end, horizon)
    total = len(merged)

    matched = merged.dropna(subset=["actual", "forecast"]).copy()

    if not matched.empty:
        matched = matched[
            np.isfinite(matched["actual"].astype(float))
            & np.isfinite(matched["forecast"].astype(float))
        ]

    count = len(matched)
    coverage = count / total * 100 if total else 0.0

    metrics = {
        "evaluation_resolution": "hourly",
        "decision_start": start,
        "decision_end": end,
        "horizon_hours": horizon,
        "total_intervals": total,
        "matched_intervals": count,
        "coverage_percent": round(coverage, 2),
        "publication_cutoff_violations": 0,
        "cutoff_compliant": True,
        "mae_mw": None,
        "rmse_mw": None,
        "bias_mw": None,
        "overforecast_intervals": 0,
        "underforecast_intervals": 0,
        "exact_match_intervals": 0,
    }

    if count == 0:
        return metrics

    errors = (
        matched["forecast"].astype(float).to_numpy()
        - matched["actual"].astype(float).to_numpy()
    )

    metrics.update({
        "mae_mw": round(float(np.mean(np.abs(errors))), 2),
        "rmse_mw": round(float(np.sqrt(np.mean(errors ** 2))), 2),
        "bias_mw": round(float(np.mean(errors)), 2),
        "overforecast_intervals": int(np.sum(errors > 0)),
        "underforecast_intervals": int(np.sum(errors < 0)),
        "exact_match_intervals": int(np.sum(errors == 0)),
    })

    return metrics
