
import pandas as pd


def select_forecast(actual_hourly_df, forecast_df, horizon):
    columns = ["time", "forecast", "publishTime", "decisionTime"]

    if actual_hourly_df.empty or forecast_df.empty:
        return pd.DataFrame(columns=columns)

    if not 0 <= horizon <= 48:
        raise ValueError("Forecast horizon must be between 0 and 48 hours.")

    actual = actual_hourly_df.copy()
    forecasts = forecast_df.copy()

    actual["time"] = pd.to_datetime(actual["time"], utc=True)
    forecasts["time"] = pd.to_datetime(forecasts["time"], utc=True)
    forecasts["publishTime"] = pd.to_datetime(
        forecasts["publishTime"], utc=True
    )
    forecasts["forecast"] = pd.to_numeric(
        forecasts["forecast"], errors="coerce"
    )

    actual = actual.dropna(subset=["time"])
    forecasts = forecasts.dropna(
        subset=["time", "publishTime", "forecast"]
    ).sort_values("publishTime")

    selected_rows = []

    for target_time in actual["time"]:
        decision_time = target_time - pd.Timedelta(hours=horizon)

        eligible = forecasts[
            (forecasts["time"] == target_time)
            & (forecasts["publishTime"] <= decision_time)
        ]

        if eligible.empty:
            continue

        latest = eligible.iloc[-1]

        selected_rows.append({
            "time": target_time,
            "forecast": float(latest["forecast"]),
            "publishTime": latest["publishTime"],
            "decisionTime": decision_time,
        })

    return pd.DataFrame(selected_rows, columns=columns)
