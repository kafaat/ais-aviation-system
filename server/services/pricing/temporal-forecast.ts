/** Rolling-origin evaluation: a forecast can only see observations before its target. */
export interface DemandObservation {
  date: Date;
  demand: number;
}
type Model = "weekday_mean" | "trailing_mean";
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
export function predictFromPast(
  past: DemandObservation[],
  target: Date,
  model: Model
) {
  const rows = past.filter(p => p.date < target).slice(-56);
  if (rows.length < 14) throw new Error("Insufficient historical observations");
  const peers = rows.filter(p => p.date.getUTCDay() === target.getUTCDay());
  return mean(
    (model === "weekday_mean" && peers.length >= 3
      ? peers
      : rows.slice(-28)
    ).map(p => p.demand)
  );
}
export function errorMetrics(
  pairs: Array<{ predicted: number; actual: number }>
) {
  if (
    pairs.some(
      p =>
        !Number.isFinite(p.actual) ||
        !Number.isFinite(p.predicted) ||
        p.actual < 0 ||
        p.predicted < 0
    )
  )
    throw new Error("Invalid evaluation observation");
  if (!pairs.length)
    return {
      mae: null,
      rmse: null,
      mape: null,
      r2: null,
      wape: null,
      sampleCount: 0,
    };
  const absolute = pairs.map(p => Math.abs(p.actual - p.predicted));
  const total = pairs.reduce((a, p) => a + p.actual, 0);
  const actualMean = total / pairs.length;
  const variance = pairs.reduce((a, p) => a + (p.actual - actualMean) ** 2, 0);
  const squared = pairs.reduce((a, p) => a + (p.actual - p.predicted) ** 2, 0);
  const nonzero = pairs.filter(p => p.actual > 0);
  return {
    mae: mean(absolute),
    rmse: Math.sqrt(squared / pairs.length),
    mape: nonzero.length
      ? 100 *
        mean(nonzero.map(p => Math.abs(p.actual - p.predicted) / p.actual))
      : null,
    r2: variance ? 1 - squared / variance : null,
    wape: total ? (100 * absolute.reduce((a, b) => a + b, 0)) / total : null,
    sampleCount: pairs.length,
  };
}
export function temporalForecast(
  observations: DemandObservation[],
  target: Date
) {
  const history = [...observations]
    .filter(p => p.date < target)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (
    history.some(
      p =>
        !Number.isFinite(p.date.getTime()) ||
        !Number.isSafeInteger(p.demand) ||
        p.demand < 0
    )
  )
    throw new Error("Invalid training observation");
  if (history.length < 42)
    throw new Error("At least 42 prior flight observations are required");
  const selectionStart = Math.max(14, history.length - 28);
  const validationStart = history.length - 14;
  const score = (model: Model, from: number, to: number) =>
    history.slice(from, to).map((p, i) => ({
      predicted: predictFromPast(history.slice(0, from + i), p.date, model),
      actual: p.demand,
    }));
  const candidate = errorMetrics(
    score("weekday_mean", selectionStart, validationStart)
  );
  const baseline = errorMetrics(
    score("trailing_mean", selectionStart, validationStart)
  );
  const model: Model =
    candidate.mae !== null &&
    baseline.mae !== null &&
    candidate.mae < baseline.mae
      ? "weekday_mean"
      : "trailing_mean";
  const calibration = score(model, selectionStart, validationStart)
    .map(p => Math.abs(p.actual - p.predicted))
    .sort((a, b) => a - b);
  const radius =
    calibration[
      Math.min(
        calibration.length - 1,
        Math.ceil((calibration.length + 1) * 0.9) - 1
      )
    ];
  if (radius === undefined) throw new Error("Calibration window is empty");
  const validation = score(model, validationStart, history.length);
  const evaluation = {
    ...errorMetrics(validation),
    baselineMae: errorMetrics(
      score("trailing_mean", validationStart, history.length)
    ).mae,
    empiricalCoverage:
      validation.filter(p => Math.abs(p.actual - p.predicted) <= radius)
        .length / validation.length,
    nominalCoverage: 0.9,
    selectionSamples: validationStart - selectionStart,
    calibrationSamples: calibration.length,
  };
  const predicted = predictFromPast(history, target, model);
  return {
    predicted,
    lower: Math.max(0, predicted - radius),
    upper: predicted + radius,
    model,
    evaluation,
    trainingCutoff: history[history.length - 1].date,
    sampleCount: history.length,
  };
}
