# WINDWISE — Wind Generation Forecast Monitor

WINDWISE is a wind generation forecast monitoring dashboard designed to help energy procurement teams evaluate historical wind generation forecasts against actual UK national wind generation. It provides forecast accuracy metrics, forecast-error visualisation, publication-cutoff validation, and downloadable evaluation data.

The application uses the Elexon BMRS API, a React frontend, a Python FastAPI backend, and Docker Compose.

## Features

- **Actual vs forecast generation:** Compare hourly actual wind generation with the selected forecast.
- **Forecast accuracy metrics:** Calculate Mean Absolute Error (MAE), Root Mean Squared Error (RMSE), and forecast bias.
- **Forecast coverage:** Report the percentage of evaluation intervals with matched actual and forecast values.
- **Forecast-error analysis:** Visualise overforecasting and underforecasting using forecast minus actual generation.
- **Decision-window controls:** Select a date range of procurement decision times and a forecast lead-time assumption.
- **Publication-cutoff validation:** Check that selected forecast publication timestamps do not exceed the calculated decision cutoffs.
- **CSV export:** Export delivery timestamps, actual generation, forecasts, decision cutoffs, and forecast publication timestamps.
- **Docker deployment:** Run the frontend and backend together using Docker Compose.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Chart.js, react-chartjs-2, Axios |
| Backend | Python, FastAPI, Uvicorn |
| Data processing | Pandas, NumPy |
| Data source | Elexon BMRS API |
| Web server / reverse proxy | Nginx |
| Containerisation | Docker, Docker Compose |

## Architecture

```text
User's Browser
      |
      v
React Dashboard
http://localhost:3000
      |
      v
Nginx Reverse Proxy
      |
      | /api/wind-data
      | /api/wind-metrics
      v
FastAPI Backend
      |
      v
Data Fetching and Processing
      |
      +--------------------------+
      |                          |
      v                          v
Elexon FUELHH/stream       Elexon WINDFOR/stream
Actual generation          Wind generation forecasts
      |                          |
      +-------------+------------+
                    |
                    v
       Forecast Selection and Matching
                    |
                    v
       Metrics and Chart Data
                    |
                    v
             React Dashboard
```

Docker Compose starts the frontend and backend as separate services. Nginx serves the React production build and forwards `/api/` requests to the backend container.

## Data Sources

WINDWISE uses the following Elexon BMRS datasets.

### 1. Actual wind generation

- **Dataset:** `FUELHH`
- **Endpoint:** `https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream`
- **Fuel type:** `WIND`
- **Relevant fields:** `startTime`, `generation`

The application retrieves actual wind generation and aggregates the half-hourly observations into hourly average generation values for comparison with hourly forecast targets.

### 2. Wind generation forecasts

- **Dataset:** `WINDFOR`
- **Endpoint:** `https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream`
- **Relevant fields:** `startTime`, `publishTime`, `generation`

The application uses:
- `startTime` to identify the delivery interval.
- `publishTime` to determine when the forecast became available.
- `generation` as the forecast wind generation value.

The publication timestamp is essential because a forecast must have been published by the applicable decision cutoff to be eligible for the evaluation.

**Data source:** [Elexon BMRS API](https://data.elexon.co.uk/bmrs/api/v1/)

## Decision Window and Forecast Selection

The dashboard's date controls represent the **decision window**, not the delivery window.

For a delivery interval with timestamp \(T\) and a selected forecast lead time \(H\), the application calculates:

\[
\text{Decision cutoff} = T-H
\]

The selected forecast is the latest available forecast for that delivery interval whose publication timestamp is no later than the calculated decision cutoff.

For example, with a 21-hour lead-time assumption:

- Delivery timestamp: 1 February 2026, 00:00 UTC
- Calculated decision cutoff: 31 January 2026, 03:00 UTC

This allows a decision window ending on 31 January to include eligible delivery intervals on 1 February.

The lead time is an **evaluation assumption**. It should not be interpreted as the official UK electricity market gate-closure time or as a guarantee that every real procurement decision is made at that time.

## Forecast Accuracy Metrics

Let \(F_i\) denote forecast generation and \(A_i\) denote actual generation for matched interval \(i\). The error is:

\[
e_i=F_i-A_i
\]

### Mean Absolute Error (MAE)

\[
\mathrm{MAE}=\frac{1}{n}\sum_{i=1}^{n}|e_i|
\]

MAE measures the average magnitude of forecast errors. Lower values indicate better accuracy.

### Root Mean Squared Error (RMSE)

\[
\mathrm{RMSE}=\sqrt{\frac{1}{n}\sum_{i=1}^{n}e_i^2}
\]

RMSE gives larger errors more influence than MAE.

### Forecast Bias

\[
\mathrm{Bias}=\frac{1}{n}\sum_{i=1}^{n}e_i
\]

- Positive bias indicates overforecasting on average.
- Negative bias indicates underforecasting on average.
- Bias near zero indicates little average directional error, but does not necessarily mean that individual forecasts are accurate.

### Forecast Coverage

\[
\mathrm{Coverage}=
\frac{\text{Matched intervals}}{\text{Total evaluation intervals}}
\times100
\]

Coverage measures data availability, not forecast accuracy. A high coverage value does not independently establish that the forecasts are accurate or that the complete set of eligible historical forecasts was retrieved.

### Evaluation Resolution

Actual generation is aggregated from half-hourly observations into hourly averages to match the hourly forecast targets used by the application. The reported metrics therefore represent hourly evaluation, not half-hourly forecast accuracy.

## Project Structure

```text
wind-forecast-app-main/
├── analysis/
│   └── forecast_analysis.ipynb
├── backend/
│   ├── data_fetcher.py
│   ├── forecast_selector.py
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.js
│   │   ├── App.css
│   │   └── ...
│   ├── nginx.conf
│   ├── Dockerfile
│   ├── package.json
│   └── package-lock.json
├── docker-compose.yml
├── .gitignore
├── LICENSE
└── README.md
```

## Prerequisites

Install the following software:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with its container engine running.
- Git, if cloning the repository.

Docker Compose is included with current Docker Desktop installations.

## Run with Docker Compose

### 1. Clone the repository

```bash
git clone <YOUR_PUBLIC_REPOSITORY_URL>
cd <YOUR_REPOSITORY_DIRECTORY>
```

Replace the placeholders with the public repository URL and directory name.

### 2. Build and start the application

Run this command from the project root, where `docker-compose.yml` is located:

```bash
docker compose up --build -d
```

### 3. Open the application

- **Dashboard:** http://localhost:3000
- **API documentation:** http://localhost:3000/api/docs

### 4. Check container status

```bash
docker compose ps
```

### 5. View logs

```bash
docker compose logs --tail=100
```

To inspect one service:

```bash
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
```

### 6. Rebuild after code changes

```bash
docker compose up --build -d
```

### 7. Stop the application

```bash
docker compose down
```

## API Endpoints

The backend exposes the following endpoints.

### `GET /wind-data`

Returns the evaluation intervals and associated actual generation, selected forecast, publication timestamp, and calculated decision cutoff.

Example query:

```text
/api/wind-data?start=2026-01-01&end=2026-01-03&horizon=21
```

### `GET /wind-metrics`

Returns the forecast accuracy metrics, coverage, interval counts, and publication-cutoff validation status.

Example query:

```text
/api/wind-metrics?start=2026-01-01&end=2026-01-03&horizon=21
```

### Query parameters

| Parameter | Description |
|---|---|
| `start` | First decision date in `YYYY-MM-DD` format |
| `end` | Last decision date in `YYYY-MM-DD` format |
| `horizon` | Forecast lead-time assumption in hours, from 0 to 48 |

The backend limits the selected decision window to 31 calendar days.

## Limitations and Assumptions

- **Hourly evaluation:** Half-hourly actual generation is averaged to hourly resolution. Results should not be described as half-hourly accuracy metrics.
- **Decision cutoff:** The cutoff is calculated using the selected forecast lead time. It is an evaluation rule, not an official market deadline.
- **Historical forecast completeness:** Publication-cutoff validation checks the eligibility of selected forecasts. It does not, by itself, prove that every eligible forecast was retrieved from the API.
- **Coverage:** Coverage describes the fraction of intervals with matched values. It should be interpreted alongside MAE, RMSE, and bias.
- **Forecast availability:** Historical API responses may contain missing observations or may not provide every forecast required for a chosen decision window.
- **Procurement interpretation:** The dashboard evaluates forecast performance. It does not calculate optimal electricity purchases, market prices, imbalance costs, or realised financial savings.
- **Data dependency:** Live queries depend on the availability and behaviour of the Elexon BMRS API.

## Testing Checklist

Before using the results in a demonstration or technical review, verify:

- [ ] Both Docker services start successfully.
- [ ] The dashboard loads data through the Nginx API proxy.
- [ ] The selected decision dates and forecast horizon reach both API endpoints.
- [ ] Forecast publication timestamps do not exceed their calculated decision cutoffs.
- [ ] January decision windows can include eligible February delivery intervals.
- [ ] MAE, RMSE, and bias use the same matched observations.
- [ ] Overforecast, underforecast, and exact-match counts reconcile with the matched interval count.
- [ ] Coverage is reported separately from forecast accuracy.
- [ ] CSV export contains the expected timestamps and generation values.

## Deployment

- **Live application:** To be added after deployment.
- **Public source repository:** To be added.
- **Demonstration video:** To be added.

The application has been run locally using Docker Compose. A public deployment should be added only after it has been deployed and verified.

## AI Tool Usage Disclosure

AI assistance was used during development to help with code refinement, debugging, frontend improvements, and documentation.

The developer is responsible for code drafting,docker configaration , reviewing, testing, and understanding the submitted implementation, including the data-processing logic, forecast-selection rules, metric calculations, and deployment configuration.


