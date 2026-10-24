
import React, { useMemo, useState } from "react";
import axios from "axios";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import "./App.css";

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Tooltip
);

const API_URL = process.env.REACT_APP_API_URL || "/api";

const utcFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatMW(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";

  return `${Number(value).toLocaleString("en-GB", {
    maximumFractionDigits: 1,
  })} MW`;
}

function formatDateTime(value) {
  if (!value) return "Unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : `${utcFormatter.format(date)} UTC`;
}

function formatAxisTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value || "");

  return date.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function MetricCard({ title, value, subtitle, icon, accent }) {
  return (
    <article className={`metric-card ${accent || ""}`}>
      <div className="metric-card-top">
        <span className="metric-label">{title}</span>
        <span className="metric-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{subtitle}</div>
    </article>
  );
}

function downloadCsv(rows) {
  if (!rows.length) return;

  const columns = [
    ["time", "delivery_time_utc"],
    ["decisionTime", "decision_cutoff_utc"],
    ["actual", "actual_mw"],
    ["forecast", "forecast_mw"],
    ["publishTime", "forecast_publish_time_utc"],
  ];

  const escapeCsv = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const content = [
    columns.map((column) => column[1]).join(","),
    ...rows.map((row) =>
      columns.map(([key]) => escapeCsv(row[key])).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\uFEFF", content], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "wind-forecast-evaluation.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function App() {
  // These dates represent decision dates, not delivery dates.
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState("2026-01-03");
  const [horizon, setHorizon] = useState(21);

  const [rows, setRows] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchData = async (event) => {
    event?.preventDefault();

    if (!start || !end) {
      setError("Choose both decision dates.");
      return;
    }

    if (start > end) {
      setError("Start date must be on or before end date.");
      return;
    }

    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    const dayCount = Math.round(
      (endDate.getTime() - startDate.getTime()) / 86400000
    ) + 1;

    if (dayCount > 31) {
      setError("Choose a maximum decision window of 31 calendar days.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = { start, end, horizon };

      const [dataResponse, metricsResponse] = await Promise.all([
        axios.get(`${API_URL}/wind-data`, { params }),
        axios.get(`${API_URL}/wind-metrics`, { params }),
      ]);

      if (!Array.isArray(dataResponse.data)) {
        throw new Error("The wind-data endpoint returned an unexpected response.");
      }

      setRows(dataResponse.data);
      setMetrics(metricsResponse.data);
      setLastUpdated(new Date());
      setHasLoaded(true);
    } catch (err) {
      console.error("Failed to load wind data:", err);
      setError(
        err.response?.data?.detail ||
          err.message ||
          "Unable to load wind data. Check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => ({
    labels: rows.map((row) => formatAxisTime(row.time)),
    datasets: [
      {
        label: "Actual generation",
        data: rows.map((row) => row.actual ?? null),
        borderColor: "#65a8ff",
        backgroundColor: "rgba(101, 168, 255, 0.10)",
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.22,
        spanGaps: false,
      },
      {
        label: "Selected forecast",
        data: rows.map((row) => row.forecast ?? null),
        borderColor: "#28c99a",
        backgroundColor: "rgba(40, 201, 154, 0.10)",
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.22,
        spanGaps: false,
      },
    ],
  }), [rows]);

  const errorChartData = useMemo(() => ({
    labels: rows.map((row) => formatAxisTime(row.time)),
    datasets: [
      {
        label: "Forecast error",
        data: rows.map((row) => {
          if (row.actual == null || row.forecast == null) return null;
          return Number(row.forecast) - Number(row.actual);
        }),
        borderColor: "#a78bfa",
        borderWidth: 1.5,
        backgroundColor: (context) => {
          const value = context.raw;

          if (value == null) return "transparent";

          return value >= 0
            ? "rgba(248, 113, 113, 0.15)"
            : "rgba(40, 201, 154, 0.15)";
        },
        pointBackgroundColor: (context) => {
          const value = context.raw;

          if (value == null) return "transparent";

          return value >= 0 ? "#f87171" : "#28c99a";
        },
        pointBorderColor: "transparent",
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.15,
        spanGaps: false,
        fill: false,
      },
    ],
  }), [rows]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        position: "top",
        align: "start",
        labels: {
          color: "#c4cedd",
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          padding: 22,
        },
      },
      tooltip: {
        backgroundColor: "#101b2c",
        titleColor: "#fff",
        bodyColor: "#d9e2ef",
        borderColor: "#34445c",
        borderWidth: 1,
        padding: 12,
        callbacks: {
          title(items) {
            if (!items.length) return "";
            return formatDateTime(rows[items[0].dataIndex]?.time);
          },
          label(context) {
            return `${context.dataset.label}: ${formatMW(context.parsed.y)}`;
          },
          afterBody(items) {
            if (!items.length) return [];

            const row = rows[items[0].dataIndex];

            return [
              `Decision cutoff: ${formatDateTime(row.decisionTime)}`,
              `Forecast publication: ${formatDateTime(row.publishTime)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: "#8291a8",
          maxTicksLimit: 9,
          maxRotation: 0,
        },
        title: {
          display: true,
          text: "Delivery interval (UTC)",
          color: "#8291a8",
        },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: "rgba(148, 163, 184, 0.12)" },
        ticks: {
          color: "#8291a8",
          callback: (value) =>
            `${(Number(value) / 1000).toLocaleString("en-GB", {
              maximumFractionDigits: 1,
            })}k`,
        },
        title: {
          display: true,
          text: "Generation (MW)",
          color: "#8291a8",
        },
      },
    },
  }), [rows]);

  const errorChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#101b2c",
        titleColor: "#fff",
        bodyColor: "#d9e2ef",
        borderColor: "#34445c",
        borderWidth: 1,
        callbacks: {
          title(items) {
            if (!items.length) return "";
            return formatDateTime(rows[items[0].dataIndex]?.time);
          },
          label(context) {
            const value = context.parsed.y;
            const direction =
              value > 0
                ? "Overforecast"
                : value < 0
                ? "Underforecast"
                : "Exact match";

            return `${direction}: ${formatMW(value)}`;
          },
          afterBody(items) {
            if (!items.length) return [];

            const row = rows[items[0].dataIndex];

            return [
              `Decision cutoff: ${formatDateTime(row.decisionTime)}`,
              `Published: ${formatDateTime(row.publishTime)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: "#8291a8",
          maxTicksLimit: 9,
          maxRotation: 0,
        },
      },
      y: {
        border: { display: false },
        grid: {
          color: (context) =>
            context.tick.value === 0
              ? "rgba(226, 232, 240, 0.55)"
              : "rgba(148, 163, 184, 0.12)",
          lineWidth: (context) => context.tick.value === 0 ? 1.5 : 1,
        },
        ticks: {
          color: "#8291a8",
          callback: (value) =>
            `${(Number(value) / 1000).toFixed(1)}k`,
        },
        title: {
          display: true,
          text: "Forecast error (MW)",
          color: "#8291a8",
        },
      },
    },
  }), [rows]);

  const latestPublication = useMemo(() => {
    const times = rows
      .map((row) => row.publishTime)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));

    if (!times.length) return null;

    return new Date(Math.max(...times.map((date) => date.getTime())));
  }, [rows]);

  const matchedRows = rows.filter(
    (row) =>
      row.actual != null &&
      row.forecast != null &&
      Number.isFinite(Number(row.actual)) &&
      Number.isFinite(Number(row.forecast))
  );

  const cutoffViolations = matchedRows.filter((row) => {
    if (!row.publishTime || !row.decisionTime) return true;

    const published = new Date(row.publishTime).getTime();
    const cutoff = new Date(row.decisionTime).getTime();

    return (
      Number.isNaN(published) ||
      Number.isNaN(cutoff) ||
      published > cutoff
    );
  }).length;

  const backendCutoffVerified = metrics?.cutoff_compliant === true;
  const cutoffVerified =
    hasLoaded &&
    backendCutoffVerified &&
    cutoffViolations === 0 &&
    matchedRows.every((row) => row.publishTime && row.decisionTime);

  const totalDecisionDays =
    start && end
      ? Math.round(
          (new Date(`${end}T00:00:00Z`).getTime() -
            new Date(`${start}T00:00:00Z`).getTime()) / 86400000
        ) + 1
      : 0;

  const decisionStart = start
    ? `${start} 00:00 UTC`
    : "Not selected";

  const decisionEnd = end
    ? `${end} 23:59 UTC`
    : "Not selected";

  const noMatchedForecasts =
    metrics && Number(metrics.matched_intervals) === 0;

  const overCount = metrics?.overforecast_intervals ?? 0;
  const underCount = metrics?.underforecast_intervals ?? 0;
  const exactCount = metrics?.exact_match_intervals ?? 0;

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <path d="M8 23h15a5 5 0 1 0-5-5" />
              <path d="M5 16h12a4 4 0 1 0-4-4" />
              <path d="M11 29h17a4 4 0 1 0-4-4" />
            </svg>
          </div>
          <div>
            <div className="brand-name">WIND<span>WISE</span></div>
            <div className="brand-caption">RENEWABLE INTELLIGENCE</div>
          </div>
        </div>

        <div className="topbar-right">
          <span className="live-dot" />
          <span>Elexon data monitor</span>
          <span className="topbar-divider" />
          <span className="topbar-tag">UK NATIONAL WIND</span>
        </div>
      </header>

      <main className="main-content">
        <section className="page-heading">
          <div>
            <div className="eyebrow">ENERGY PROCUREMENT / ANALYTICS</div>
            <h1>Wind forecast monitor</h1>
            <p>
              Evaluate historical wind generation forecasts against actual
              output to support day-ahead electricity procurement decisions.
            </p>
          </div>

          <div className="updated-indicator">
            <span className="updated-dot" />
            <div>
              <span className="updated-label">LAST SUCCESSFUL LOAD</span>
              <strong>
                {lastUpdated
                  ? lastUpdated.toLocaleTimeString("en-GB")
                  : "Not loaded yet"}
              </strong>
            </div>
          </div>
        </section>

        <section className="filter-panel">
          <div className="filter-heading">
            <div>
              <h2>Decision-window settings</h2>
              <p>
                Choose the dates on which decisions are evaluated. Delivery
                intervals may fall on later calendar dates.
              </p>
            </div>
            <span className="utc-badge">ALL TIMES IN UTC</span>
          </div>

          <form className="filter-controls" onSubmit={fetchData}>
            <div className="field-group">
              <label htmlFor="start-date">Decision start date</label>
              <input
                id="start-date"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label htmlFor="end-date">Decision end date</label>
              <input
                id="end-date"
                type="date"
                value={end}
                min={start}
                onChange={(event) => setEnd(event.target.value)}
                required
              />
            </div>

            <div className="field-group horizon-field">
              <div className="horizon-label-row">
                <label htmlFor="horizon">Minimum forecast lead time</label>
                <strong>{horizon} hours</strong>
              </div>
              <input
                id="horizon"
                className="range-input"
                type="range"
                min="0"
                max="48"
                step="1"
                value={horizon}
                onChange={(event) => setHorizon(Number(event.target.value))}
              />
              <div className="range-endpoints">
                <span>0h · Nowcast</span>
                <span>48h · Ahead</span>
              </div>
            </div>

            <button
              className="primary-button"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Loading
                </>
              ) : (
                <>
                  <span aria-hidden="true">↻</span>
                  Load analysis
                </>
              )}
            </button>
          </form>

          <div className="decision-window-summary">
            <div>
              <span>Decision window begins</span>
              <strong>{decisionStart}</strong>
            </div>
            <div>
              <span>Decision window ends</span>
              <strong>{decisionEnd}</strong>
            </div>
            <div>
              <span>Decision days</span>
              <strong>{totalDecisionDays || "—"}</strong>
            </div>
            <div>
              <span>Cutoff rule</span>
              <strong>Delivery time − {horizon}h</strong>
            </div>
          </div>

          <p className="assumption-note">
            This lead-time rule is an evaluation assumption. It is not a
            representation of the official market gate-closure time.
          </p>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span className="error-symbol">!</span>
            <div>
              <strong>Unable to load analysis</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="loading-banner" role="status">
            Retrieving Elexon data and validating forecast publication times…
          </div>
        )}

        <section className="section-block">
          <div className="section-heading">
            <div>
              <div className="eyebrow">PERFORMANCE SNAPSHOT</div>
              <h2>Forecast accuracy</h2>
            </div>
            {metrics && (
              <span className="resolution-badge">
                <span className="small-green-dot" />
                Hourly evaluation
              </span>
            )}
          </div>

          {metrics ? (
            <div className="metrics-grid">
              <MetricCard
                title="Mean absolute error"
                value={formatMW(metrics.mae_mw)}
                subtitle="Average magnitude of forecast error · lower is better"
                accent="accent-blue"
                icon="↕"
              />
              <MetricCard
                title="Root mean squared error"
                value={formatMW(metrics.rmse_mw)}
                subtitle="Penalises larger forecast errors"
                accent="accent-purple"
                icon="⌁"
              />
              <MetricCard
                title="Forecast bias"
                value={formatMW(metrics.bias_mw)}
                subtitle={
                  metrics.bias_mw == null
                    ? "Not enough matched data"
                    : Number(metrics.bias_mw) > 0
                    ? "Positive · forecasts overestimate"
                    : Number(metrics.bias_mw) < 0
                    ? "Negative · forecasts underestimate"
                    : "No average directional bias"
                }
                accent="accent-green"
                icon="±"
              />
              <MetricCard
                title="Interval coverage"
                value={`${Number(metrics.coverage_percent || 0).toFixed(1)}%`}
                subtitle={`${metrics.matched_intervals} of ${metrics.total_intervals} hourly intervals matched`}
                accent="accent-amber"
                icon="◉"
              />
            </div>
          ) : (
            <div className="empty-state compact-empty">
              <div className="empty-icon">↗</div>
              <strong>Your analysis will appear here</strong>
              <p>Choose a decision window and load the analysis.</p>
            </div>
          )}
        </section>

        <section className="chart-panel">
          <div className="chart-header">
            <div>
              <div className="eyebrow">GENERATION PROFILE</div>
              <h2>Actual vs forecast generation</h2>
              <p>Hourly wind generation · MW · timestamps shown in UTC</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => downloadCsv(rows)}
              disabled={!rows.length}
              type="button"
            >
              <span aria-hidden="true">↓</span> Export CSV
            </button>
          </div>

          {rows.length ? (
            <div className="chart-container">
              <Line data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div className="empty-state chart-empty">
              <div className="empty-icon">⌁</div>
              <strong>No chart data loaded</strong>
              <p>Load a decision window to compare actual and forecast output.</p>
            </div>
          )}

          {rows.length > 0 && (
            <div className="chart-footer">
              <span>
                <span className="footer-dot blue-dot" />
                {rows.length} delivery intervals in the decision window
              </span>
              <span>
                <span className="footer-dot green-dot" />
                Latest returned publication: {formatDateTime(latestPublication)}
              </span>
            </div>
          )}
        </section>

        <section className="chart-panel">
          <div className="chart-header">
            <div>
              <div className="eyebrow">FORECAST ERROR ANALYSIS</div>
              <h2>Overforecast vs underforecast</h2>
              <p>
                Error = forecast generation − actual generation. The horizontal
                zero line represents an exact forecast.
              </p>
            </div>
          </div>

          <div className="error-legend">
            <span><i className="error-dot over" /> Overforecast · positive error</span>
            <span><i className="error-dot under" /> Underforecast · negative error</span>
          </div>

          {rows.length > 0 ? (
            <div className="chart-container">
              <Line data={errorChartData} options={errorChartOptions} />
            </div>
          ) : (
            <div className="empty-state chart-empty">
              <strong>No error data loaded</strong>
              <p>Load an evaluation window to inspect forecast errors.</p>
            </div>
          )}

          {metrics && (
            <div className="error-count-grid">
              <div className="error-count over-count">
                <span>Overforecast intervals</span>
                <strong>{overCount}</strong>
              </div>
              <div className="error-count under-count">
                <span>Underforecast intervals</span>
                <strong>{underCount}</strong>
              </div>
              <div className="error-count exact-count">
                <span>Exact matches</span>
                <strong>{exactCount}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="details-grid">
          <article className="detail-panel">
            <div className="detail-title">
              <span className="detail-icon">◷</span>
              <div>
                <h3>Decision context</h3>
                <p>Evaluation configuration</p>
              </div>
            </div>

            <div className="detail-row">
              <span>Decision window</span>
              <strong>{start} → {end}</strong>
            </div>
            <div className="detail-row">
              <span>Minimum lead time</span>
              <strong>{horizon} hours</strong>
            </div>
            <div className="detail-row">
              <span>Evaluation resolution</span>
              <strong>Hourly average</strong>
            </div>
            <div className="detail-row">
              <span>Decision-cutoff rule</span>
              <strong>Delivery timestamp − horizon</strong>
            </div>

            <div className="detail-note">
              The delivery timestamp can be on a later date than the decision
              timestamp. For example, a delivery on 1 February at 00:00 UTC
              with a 21-hour lead time has a calculated cutoff of 31 January
              at 03:00 UTC.
            </div>
          </article>

          <article className="detail-panel">
            <div className="detail-title">
              <span className="detail-icon">✓</span>
              <div>
                <h3>Data quality & validation</h3>
                <p>Availability and publication eligibility</p>
              </div>
            </div>

            <div className="quality-row">
              <span>Actual intervals</span>
              <strong>{metrics?.total_intervals ?? "—"}</strong>
            </div>
            <div className="quality-row">
              <span>Matched forecasts</span>
              <strong>{metrics?.matched_intervals ?? "—"}</strong>
            </div>
            <div className="quality-row">
              <span>Publication timestamps returned</span>
              <strong>
                {rows.length && rows.some((row) => row.publishTime)
                  ? "Available"
                  : "Not available"}
              </strong>
            </div>
            <div className="quality-row">
              <span>Client-side cutoff check</span>
              <strong className={cutoffVerified ? "validation-pass" : "validation-fail"}>
                {!hasLoaded
                  ? "Not run"
                  : cutoffVerified
                  ? "Passed"
                  : "Not verified"}
              </strong>
            </div>
            <div className="quality-row">
              <span>Backend cutoff violations</span>
              <strong className={
                metrics?.cutoff_compliant === true &&
                metrics?.publication_cutoff_violations === 0
                  ? "validation-pass"
                  : "validation-fail"
              }>
                {metrics?.publication_cutoff_violations ?? "Not verified"}
              </strong>
            </div>

            {noMatchedForecasts && (
              <div className="quality-warning">
                No forecasts matched this decision window and lead time.
                Accuracy metrics are unavailable.
              </div>
            )}

            <div className="detail-note">
              Coverage measures matched intervals, not forecast quality.
              Actual half-hourly values are averaged to hourly resolution to
              align with hourly forecast targets. The lead-time cutoff is an
              evaluation assumption, not the official market gate closure.
            </div>
          </article>
        </section>

        <footer className="page-footer">
          <span>
            WINDWISE <span className="footer-muted">· Forecast evaluation dashboard</span>
          </span>
          <span>Source: Elexon BMRS · National wind generation</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
