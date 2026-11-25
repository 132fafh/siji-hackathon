'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_COLUMNS = [
  'p_recall',
  'timestamp',
  'delta',
  'user_id',
  'lexeme_id',
  'history_seen',
  'history_correct',
  'session_seen',
  'session_correct',
  'split',
];
const MODEL_NAMES = ['constant', 'exponential', 'power', 'weibull', 'hlr', 'hlr_scaled'];
const EPSILON = 1e-6;
const LN2 = Math.log(2);
const FEATURE_NAMES = [
  'intercept',
  'log1p_history_seen',
  'log1p_history_correct',
  'log1p_history_incorrect',
  'log1p_session_seen',
];

function clipProbability(value) {
  return Math.min(1 - EPSILON, Math.max(EPSILON, value));
}

function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function logit(value) {
  const p = clipProbability(value);
  return Math.log(p / (1 - p));
}

function parseCsvLine(line, lineNumber) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;

  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (inQuotes) {
      if (character === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
    } else if (character === ',') {
      fields.push(field);
      field = '';
      afterQuote = false;
    } else if (character === '"') {
      if (field.length !== 0 || afterQuote) {
        throw new Error(`CSV 第 ${lineNumber} 行含位置错误的引号`);
      }
      inQuotes = true;
    } else {
      if (afterQuote) {
        throw new Error(`CSV 第 ${lineNumber} 行的结束引号后存在多余字符`);
      }
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error(`CSV 第 ${lineNumber} 行有未闭合的引号`);
  }
  fields.push(field);
  return fields;
}

function numberFromField(value, name, lineNumber) {
  if (value.trim() === '') {
    throw new Error(`CSV 第 ${lineNumber} 行的 ${name} 为空`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`CSV 第 ${lineNumber} 行的 ${name} 不是有限数值: ${value}`);
  }
  return number;
}

function integerFromField(value, name, lineNumber, minimum) {
  const number = numberFromField(value, name, lineNumber);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`CSV 第 ${lineNumber} 行的 ${name} 必须是大于等于 ${minimum} 的整数`);
  }
  return number;
}

function readDataset(inputPath) {
  let text;
  try {
    text = fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取输入文件 ${inputPath}: ${error.message}`);
  }

  const lines = text.split(/\r\n|\n|\r/);
  let header = null;
  let headerLine = 0;
  let firstDataLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') {
      header = parseCsvLine(lines[i].replace(/^\uFEFF/, ''), i + 1).map((name) => name.trim());
      headerLine = i + 1;
      firstDataLine = i + 1;
      break;
    }
  }
  if (!header) {
    throw new Error('输入 CSV 为空，缺少表头');
  }
  if (new Set(header).size !== header.length) {
    throw new Error(`CSV 第 ${headerLine} 行表头含重复列`);
  }
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  const unexpected = header.filter((name) => !REQUIRED_COLUMNS.includes(name));
  if (missing.length || unexpected.length || header.length !== REQUIRED_COLUMNS.length) {
    throw new Error(
      `CSV 列不符合约定；缺少=[${missing.join(', ')}]，未知=[${unexpected.join(', ')}]`,
    );
  }

  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const rows = [];
  const trainUsers = new Set();
  const testUsers = new Set();

  for (let i = firstDataLine; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    const lineNumber = i + 1;
    const fields = parseCsvLine(lines[i], lineNumber);
    if (fields.length !== header.length) {
      throw new Error(
        `CSV 第 ${lineNumber} 行有 ${fields.length} 列，预期 ${header.length} 列`,
      );
    }
    const pRecall = numberFromField(fields[index.p_recall], 'p_recall', lineNumber);
    if (pRecall < 0 || pRecall > 1) {
      throw new Error(`CSV 第 ${lineNumber} 行的 p_recall 必须在 [0,1] 内`);
    }
    const timestamp = numberFromField(fields[index.timestamp], 'timestamp', lineNumber);
    const delta = numberFromField(fields[index.delta], 'delta', lineNumber);
    if (delta < 0) {
      throw new Error(`CSV 第 ${lineNumber} 行的 delta 必须是非负秒数`);
    }
    const historySeen = integerFromField(fields[index.history_seen], 'history_seen', lineNumber, 0);
    const historyCorrect = integerFromField(
      fields[index.history_correct],
      'history_correct',
      lineNumber,
      0,
    );
    if (historyCorrect > historySeen) {
      throw new Error(`CSV 第 ${lineNumber} 行的 history_correct 不能大于 history_seen`);
    }
    const sessionSeen = integerFromField(fields[index.session_seen], 'session_seen', lineNumber, 1);
    const sessionCorrect = integerFromField(
      fields[index.session_correct],
      'session_correct',
      lineNumber,
      0,
    );
    if (sessionCorrect > sessionSeen) {
      throw new Error(`CSV 第 ${lineNumber} 行的 session_correct 不能大于 session_seen`);
    }
    const userId = fields[index.user_id];
    const lexemeId = fields[index.lexeme_id];
    if (!userId.trim() || !lexemeId.trim()) {
      throw new Error(`CSV 第 ${lineNumber} 行的 user_id 和 lexeme_id 不能为空`);
    }
    const split = fields[index.split].trim();
    if (split !== 'train' && split !== 'test') {
      throw new Error(`CSV 第 ${lineNumber} 行的 split 必须是 train 或 test`);
    }
    if (split === 'train') trainUsers.add(userId);
    else testUsers.add(userId);

    rows.push({
      pRecall,
      timestamp,
      delta,
      userId,
      lexemeId,
      historySeen,
      historyCorrect,
      sessionSeen,
      sessionCorrect,
      split,
      sourceLine: lineNumber,
    });
  }

  if (!rows.length) throw new Error('输入 CSV 没有数据行');
  const train = rows.filter((row) => row.split === 'train');
  const test = rows.filter((row) => row.split === 'test');
  if (!train.length) throw new Error('训练集为空，无法拟合模型');
  if (!test.length) throw new Error('测试集为空，无法生成测试指标和预测');
  const overlappingUsers = [...trainUsers].filter((user) => testUsers.has(user));
  if (overlappingUsers.length) {
    throw new Error(`train/test 存在重叠 user_id，例如: ${overlappingUsers.slice(0, 3).join(', ')}`);
  }
  return { rows, train, test };
}

function totalWeight(rows) {
  let total = 0;
  for (const row of rows) total += row.sessionSeen;
  return total;
}

function weightedMeanRecall(rows) {
  let weightedSum = 0;
  let weight = 0;
  for (const row of rows) {
    weightedSum += row.sessionSeen * row.pRecall;
    weight += row.sessionSeen;
  }
  return clipProbability(weightedSum / weight);
}

function weightedAuc(rows, predictions) {
  const ranked = [];
  let positives = 0;
  let negatives = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const positive = rows[i].sessionCorrect;
    const negative = rows[i].sessionSeen - rows[i].sessionCorrect;
    positives += positive;
    negatives += negative;
    if (positive + negative > 0) ranked.push({ p: predictions[i], positive, negative });
  }
  const denominator = positives * negatives;
  if (denominator === 0) return null;
  ranked.sort((a, b) => a.p - b.p);
  let concordance = 0;
  let negativesBelow = 0;
  let i = 0;
  while (i < ranked.length) {
    let j = i + 1;
    let positiveTies = ranked[i].positive;
    let negativeTies = ranked[i].negative;
    while (j < ranked.length && ranked[j].p === ranked[i].p) {
      positiveTies += ranked[j].positive;
      negativeTies += ranked[j].negative;
      j += 1;
    }
    concordance += positiveTies * (negativesBelow + 0.5 * negativeTies);
    negativesBelow += negativeTies;
    i = j;
  }
  return concordance / denominator;
}

function calibrationBins(rows, predictions) {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    bin: index + 1,
    lower: index / 10,
    upper: (index + 1) / 10,
    sampleCount: 0,
    weight: 0,
    predictionSum: 0,
    observedSum: 0,
  }));
  for (let i = 0; i < rows.length; i += 1) {
    const bin = bins[Math.min(9, Math.floor(predictions[i] * 10))];
    const weight = rows[i].sessionSeen;
    bin.sampleCount += 1;
    bin.weight += weight;
    bin.predictionSum += weight * predictions[i];
    bin.observedSum += weight * rows[i].pRecall;
  }
  return bins.map((bin) => ({
    bin: bin.bin,
    lower: bin.lower,
    upper: bin.upper,
    sampleCount: bin.sampleCount,
    weight: bin.weight,
    meanPrediction: bin.weight ? bin.predictionSum / bin.weight : null,
    observedRecall: bin.weight ? bin.observedSum / bin.weight : null,
  }));
}

function evaluateRows(rows, predict) {
  const predictions = new Array(rows.length);
  let weight = 0;
  let logLoss = 0;
  let brier = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const p = clipProbability(predict(row));
    predictions[i] = p;
    const w = row.sessionSeen;
    const y = row.pRecall;
    weight += w;
    logLoss += w * (-y * Math.log(p) - (1 - y) * Math.log1p(-p));
    brier += w * (p - y) ** 2;
  }
  return {
    weightedLogLoss: logLoss / weight,
    weightedBrier: brier / weight,
    weightedAuc: weightedAuc(rows, predictions),
    sampleCount: rows.length,
    totalWeight: weight,
    positiveWeight: rows.reduce((sum, row) => sum + row.sessionCorrect, 0),
    negativeWeight: rows.reduce((sum, row) => sum + row.sessionSeen - row.sessionCorrect, 0),
    predictions,
    calibration: calibrationBins(rows, predictions),
  };
}

function curvePrediction(name, parameters, row, timeDays = row.delta / 86400) {
  const b = sigmoid(parameters[0]);
  let p;
  if (name === 'exponential') {
    const lambda = Math.exp(parameters[1]);
    p = b * Math.exp(-lambda * timeDays);
  } else if (name === 'power') {
    const gamma = Math.exp(parameters[1]);
    const beta = Math.exp(parameters[2]);
    p = b * Math.pow(1 + gamma * timeDays, -beta);
  } else if (name === 'weibull') {
    const lambda = Math.exp(parameters[1]);
    const k = Math.exp(parameters[2]);
    p = b * Math.exp(-Math.pow(lambda * timeDays, k));
  } else {
    throw new Error(`未知曲线模型: ${name}`);
  }
  return clipProbability(p);
}

function nelderMead(objective, initial, options) {
  const dimensions = initial.length;
  const simplex = [initial.slice()];
  const steps = [0.2, 0.25, 0.25];
  for (let i = 0; i < dimensions; i += 1) {
    const point = initial.slice();
    point[i] += steps[i] || 0.2;
    simplex.push(point);
  }
  let values = simplex.map(objective);
  let evaluations = values.length;
  let iterations = 0;
  let converged = false;
  let stopReason = 'iteration_limit';
  const deadline = Date.now() + options.maxMs;

  while (iterations < options.maxIterations) {
    if (evaluations >= options.maxEvaluations) {
      stopReason = 'evaluation_limit';
      break;
    }
    if (Date.now() >= deadline) {
      stopReason = 'time_limit';
      break;
    }
    const order = values.map((value, index) => index).sort((a, b) => values[a] - values[b]);
    const sortedSimplex = order.map((index) => simplex[index]);
    const sortedValues = order.map((index) => values[index]);
    for (let i = 0; i < simplex.length; i += 1) {
      simplex[i] = sortedSimplex[i];
      values[i] = sortedValues[i];
    }
    let parameterSpread = 0;
    for (let i = 1; i < simplex.length; i += 1) {
      for (let j = 0; j < dimensions; j += 1) {
        parameterSpread = Math.max(parameterSpread, Math.abs(simplex[i][j] - simplex[0][j]));
      }
    }
    const valueSpread = Math.abs(values[values.length - 1] - values[0]);
    if (iterations >= 20 && parameterSpread < 1e-7 && valueSpread < 1e-10) {
      converged = true;
      stopReason = 'converged';
      break;
    }

    const centroid = new Array(dimensions).fill(0);
    for (let i = 0; i < dimensions; i += 1) {
      for (let j = 0; j < dimensions; j += 1) centroid[j] += simplex[i][j] / dimensions;
    }
    const worst = simplex[dimensions];
    const reflected = centroid.map((value, j) => value + (value - worst[j]));
    const reflectedValue = objective(reflected);
    evaluations += 1;

    if (reflectedValue < values[0]) {
      const expanded = centroid.map((value, j) => value + 2 * (reflected[j] - value));
      const expandedValue = objective(expanded);
      evaluations += 1;
      if (expandedValue < reflectedValue) {
        simplex[dimensions] = expanded;
        values[dimensions] = expandedValue;
      } else {
        simplex[dimensions] = reflected;
        values[dimensions] = reflectedValue;
      }
    } else if (reflectedValue < values[dimensions - 1]) {
      simplex[dimensions] = reflected;
      values[dimensions] = reflectedValue;
    } else {
      const contracted = centroid.map((value, j) => value + 0.5 * (worst[j] - value));
      const contractedValue = objective(contracted);
      evaluations += 1;
      if (contractedValue < values[dimensions]) {
        simplex[dimensions] = contracted;
        values[dimensions] = contractedValue;
      } else {
        for (let i = 1; i < simplex.length; i += 1) {
          for (let j = 0; j < dimensions; j += 1) {
            simplex[i][j] = simplex[0][j] + 0.5 * (simplex[i][j] - simplex[0][j]);
          }
          values[i] = objective(simplex[i]);
          evaluations += 1;
        }
      }
    }
    iterations += 1;
  }

  const bestIndex = values.indexOf(Math.min(...values));
  return {
    point: simplex[bestIndex].slice(),
    objective: values[bestIndex],
    iterations,
    evaluations,
    converged,
    stopReason,
  };
}

function fitCurve(name, train) {
  const mean = weightedMeanRecall(train);
  let initial;
  if (name === 'exponential') initial = [logit(mean), Math.log(0.1)];
  else if (name === 'power') initial = [logit(mean), Math.log(0.5), 0];
  else if (name === 'weibull') initial = [logit(mean), Math.log(0.1), 0];
  else throw new Error(`未知曲线模型: ${name}`);

  const weight = totalWeight(train);
  const regularization = 1e-7;
  const options = { maxIterations: 300, maxEvaluations: 1800, maxMs: 15000 };
  const objective = (parameters) => {
    if (parameters.some((value) => !Number.isFinite(value) || Math.abs(value) > 12)) {
      return 1e6 + parameters.reduce((sum, value) => sum + (Number.isFinite(value) ? value ** 2 : 1e6), 0);
    }
    let loss = 0;
    for (const row of train) {
      const p = curvePrediction(name, parameters, row);
      const y = row.pRecall;
      loss += row.sessionSeen * (-y * Math.log(p) - (1 - y) * Math.log1p(-p));
    }
    return loss / weight + regularization * parameters.reduce((sum, value) => sum + value * value, 0);
  };
  const result = nelderMead(objective, initial, options);
  const parameters = result.point;
  const readable = { a: parameters[0], b: sigmoid(parameters[0]) };
  if (name === 'exponential') {
    readable.logLambda = parameters[1];
    readable.lambda = Math.exp(parameters[1]);
  } else if (name === 'power') {
    readable.logGamma = parameters[1];
    readable.gamma = Math.exp(parameters[1]);
    readable.logBeta = parameters[2];
    readable.beta = Math.exp(parameters[2]);
  } else {
    readable.logLambda = parameters[1];
    readable.lambda = Math.exp(parameters[1]);
    readable.logK = parameters[2];
    readable.k = Math.exp(parameters[2]);
  }
  return {
    predict: (row, timeDays) => curvePrediction(name, parameters, row, timeDays),
    parameters: readable,
    fit: {
      method: 'Nelder-Mead',
      deterministicInitialization: initial,
      regularization,
      objective: result.objective,
      iterations: result.iterations,
      evaluations: result.evaluations,
      converged: result.converged,
      stopReason: result.stopReason,
      limits: options,
    },
  };
}

function rawFeatures(row) {
  return [
    1,
    Math.log1p(row.historySeen),
    Math.log1p(row.historyCorrect),
    Math.log1p(Math.max(0, row.historySeen - row.historyCorrect)),
    Math.log1p(row.sessionSeen),
  ];
}

function featureStatistics(train) {
  const means = [0, 0, 0, 0, 0];
  const scales = [1, 0, 0, 0, 0];
  const weight = totalWeight(train);
  for (const row of train) {
    const features = rawFeatures(row);
    for (let j = 1; j < features.length; j += 1) means[j] += row.sessionSeen * features[j] / weight;
  }
  for (const row of train) {
    const features = rawFeatures(row);
    for (let j = 1; j < features.length; j += 1) {
      scales[j] += row.sessionSeen * (features[j] - means[j]) ** 2 / weight;
    }
  }
  for (let j = 1; j < scales.length; j += 1) {
    scales[j] = Math.sqrt(scales[j]);
    if (scales[j] < 1e-8) scales[j] = 1;
  }
  return { means, scales };
}

function standardizedFeatures(row, statistics) {
  const raw = rawFeatures(row);
  return raw.map((value, j) => (j === 0 ? 1 : (value - statistics.means[j]) / statistics.scales[j]));
}

function hlrProbability(theta, features, timeDays) {
  let z = 0;
  for (let j = 0; j < theta.length; j += 1) z += theta[j] * features[j];
  z = Math.max(-30, Math.min(30, z));
  const q = LN2 * timeDays * Math.pow(2, -z);
  return clipProbability(Math.exp(-q));
}

function hlrObjectiveAndGradient(theta, train, features, weight, l2, withGradient = true) {
  const gradient = withGradient ? new Array(theta.length).fill(0) : null;
  let loss = 0;
  for (let i = 0; i < train.length; i += 1) {
    const row = train[i];
    const x = features[i];
    let z = 0;
    for (let j = 0; j < theta.length; j += 1) z += theta[j] * x[j];
    z = Math.max(-30, Math.min(30, z));
    const q = LN2 * (row.delta / 86400) * Math.pow(2, -z);
    const rawP = Math.exp(-q);
    const p = clipProbability(rawP);
    const y = row.pRecall;
    const w = row.sessionSeen;
    loss += w * (-y * Math.log(p) - (1 - y) * Math.log1p(-p));
    if (withGradient) {
      const lossDerivative = w * (-y / p + (1 - y) / (1 - p)) / weight;
      let probabilityDerivative = 0;
      if (rawP > EPSILON && rawP < 1 - EPSILON && Number.isFinite(q)) {
        probabilityDerivative = rawP * q * LN2;
      }
      const zDerivative = lossDerivative * probabilityDerivative;
      for (let j = 0; j < theta.length; j += 1) gradient[j] += zDerivative * x[j];
    }
  }
  loss /= weight;
  for (let j = 1; j < theta.length; j += 1) {
    loss += 0.5 * l2 * theta[j] ** 2;
    if (withGradient) gradient[j] += l2 * theta[j];
  }
  return { loss, gradient };
}

function checkHlrGradient(theta, train, features, weight, l2) {
  const step = 1e-5;
  const analytic = hlrObjectiveAndGradient(theta, train, features, weight, l2).gradient;
  const numeric = [];
  for (let j = 0; j < theta.length; j += 1) {
    const upper = theta.slice();
    const lower = theta.slice();
    upper[j] += step;
    lower[j] -= step;
    const upperLoss = hlrObjectiveAndGradient(upper, train, features, weight, l2, false).loss;
    const lowerLoss = hlrObjectiveAndGradient(lower, train, features, weight, l2, false).loss;
    numeric.push((upperLoss - lowerLoss) / (2 * step));
  }
  const absoluteErrors = analytic.map((value, j) => Math.abs(value - numeric[j]));
  const relativeErrors = analytic.map((value, j) => (
    Math.abs(value - numeric[j]) / Math.max(1, Math.abs(value), Math.abs(numeric[j]))
  ));
  const scale = Math.max(...analytic.map(Math.abs));
  const direction = analytic.map((value) => -value / Math.max(scale, 1e-12));
  const upper = theta.map((value, j) => value + step * direction[j]);
  const lower = theta.map((value, j) => value - step * direction[j]);
  const numericDirectionalDerivative = (
    hlrObjectiveAndGradient(upper, train, features, weight, l2, false).loss
    - hlrObjectiveAndGradient(lower, train, features, weight, l2, false).loss
  ) / (2 * step);
  const analyticDirectionalDerivative = analytic.reduce(
    (sum, value, j) => sum + value * direction[j],
    0,
  );
  const maxAbsError = Math.max(...absoluteErrors);
  const maxRelativeError = Math.max(...relativeErrors);
  const passed = maxAbsError < 1e-5 && numericDirectionalDerivative < 0;
  return {
    method: 'central finite differences at initialization',
    step,
    analytic,
    numeric,
    maxAbsError,
    maxRelativeError,
    negativeGradientDirection: direction,
    analyticDirectionalDerivative,
    numericDirectionalDerivative,
    passed,
  };
}

function initialHlrTheta(train, weight) {
  const meanRecall = weightedMeanRecall(train);
  let meanTime = 0;
  for (const row of train) meanTime += row.sessionSeen * (row.delta / 86400) / weight;
  const halfLife = meanTime / Math.max(1e-12, -Math.log2(meanRecall));
  const intercept = Math.max(-4, Math.min(12, Math.log2(Math.max(1e-12, halfLife))));
  return [intercept, 0, 0, 0, 0];
}

function fitHlr(train) {
  const statistics = featureStatistics(train);
  const features = train.map((row) => standardizedFeatures(row, statistics));
  const weight = totalWeight(train);
  const initialTheta = initialHlrTheta(train, weight);
  const theta = initialTheta.slice();
  const firstMoment = new Array(theta.length).fill(0);
  const secondMoment = new Array(theta.length).fill(0);
  const learningRate = 0.005;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEpsilon = 1e-8;
  const l2 = 1e-4;
  const options = { maxIterations: 700, maxMs: 45000, patience: 120 };
  const deadline = Date.now() + options.maxMs;
  const gradientCheck = checkHlrGradient(theta, train, features, weight, l2);
  if (!gradientCheck.passed) {
    throw new Error(`HLR 梯度有限差分校验失败，最大绝对误差 ${gradientCheck.maxAbsError}`);
  }
  const initialEvaluation = hlrObjectiveAndGradient(theta, train, features, weight, l2);
  const initialLoss = initialEvaluation.loss;
  let bestLoss = initialLoss;
  let bestTheta = theta.slice();
  let bestIteration = 0;
  let bestGradientNorm = Math.max(...initialEvaluation.gradient.map(Math.abs));
  let iterations = 0;
  let iterationsSinceBest = 0;
  let increasedLossIterations = 0;
  let converged = false;
  let stopReason = 'iteration_limit';
  let previousLoss = initialLoss;
  let lastLoss = initialLoss;

  while (iterations < options.maxIterations) {
    if (Date.now() >= deadline) {
      stopReason = 'time_limit';
      break;
    }
    const evaluation = hlrObjectiveAndGradient(theta, train, features, weight, l2);
    const { loss, gradient } = evaluation;
    if (!Number.isFinite(loss) || gradient.some((value) => !Number.isFinite(value))) {
      throw new Error(`HLR 第 ${iterations + 1} 次迭代出现非有限目标或梯度`);
    }
    lastLoss = loss;
    if (loss > previousLoss) increasedLossIterations += 1;
    if (loss < bestLoss - 1e-12) {
      bestLoss = loss;
      bestTheta = theta.slice();
      bestIteration = iterations + 1;
      bestGradientNorm = Math.max(...gradient.map(Math.abs));
      iterationsSinceBest = 0;
    } else {
      iterationsSinceBest += 1;
    }
    iterations += 1;
    const currentLearningRate = learningRate / (1 + iterations / 300);
    for (let j = 0; j < theta.length; j += 1) {
      firstMoment[j] = beta1 * firstMoment[j] + (1 - beta1) * gradient[j];
      secondMoment[j] = beta2 * secondMoment[j] + (1 - beta2) * gradient[j] ** 2;
      const correctedFirst = firstMoment[j] / (1 - Math.pow(beta1, iterations));
      const correctedSecond = secondMoment[j] / (1 - Math.pow(beta2, iterations));
      theta[j] -= currentLearningRate * correctedFirst / (Math.sqrt(correctedSecond) + adamEpsilon);
    }
    previousLoss = loss;
    if (iterations >= 250 && iterationsSinceBest >= options.patience) {
      converged = true;
      stopReason = 'no_improvement';
      break;
    }
  }
  const adamBestLoss = bestLoss;
  const refinementOptions = { maxIterations: 350, maxEvaluations: 2000, maxMs: 30000 };
  const refinement = nelderMead(
    (candidate) => hlrObjectiveAndGradient(candidate, train, features, weight, l2, false).loss,
    bestTheta,
    refinementOptions,
  );
  if (Number.isFinite(refinement.objective) && refinement.objective < bestLoss) {
    bestLoss = refinement.objective;
    bestTheta = refinement.point.slice();
  }
  theta.splice(0, theta.length, ...bestTheta);

  return {
    predict: (row, timeDays = row.delta / 86400) => (
      hlrProbability(theta, standardizedFeatures(row, statistics), timeDays)
    ),
    predictFeatures: (featureVector, timeDays) => hlrProbability(theta, featureVector, timeDays),
    trainFeatures: features,
    parameters: {
      theta: theta.slice(),
      featureNames: FEATURE_NAMES,
      standardization: statistics,
      halfLifeFormula: 'h=2^(theta·x); p=2^(-t/h)',
    },
    fit: {
      method: 'full-batch Adam + Nelder-Mead refinement with best-parameter restore',
      deterministicInitialization: initialTheta,
      initialization: 'intercept from weighted mean time and recall; other coefficients zero',
      learningRate,
      learningRateSchedule: 'learningRate/(1+iteration/300)',
      l2,
      initialObjective: initialLoss,
      adamBestObjective: adamBestLoss,
      objective: bestLoss,
      lastObjective: lastLoss,
      bestIteration,
      adamBestMaxAbsGradient: bestGradientNorm,
      iterations,
      increasedLossIterations,
      converged: converged || refinement.converged,
      stopReason,
      refinement: {
        method: 'Nelder-Mead',
        objective: refinement.objective,
        iterations: refinement.iterations,
        evaluations: refinement.evaluations,
        converged: refinement.converged,
        stopReason: refinement.stopReason,
        limits: refinementOptions,
      },
      gradientCheck,
      limits: options,
    },
  };
}

function hlrScaledProbability(parameters, features, timeDays) {
  const b = sigmoid(parameters[0]);
  let z = 0;
  for (let j = 1; j < parameters.length; j += 1) z += parameters[j] * features[j - 1];
  z = Math.max(-30, Math.min(30, z));
  const q = LN2 * timeDays * Math.pow(2, -z);
  return clipProbability(b * Math.exp(-q));
}

function hlrScaledObjectiveAndGradient(parameters, train, features, weight, l2, withGradient = true) {
  const gradient = withGradient ? new Array(parameters.length).fill(0) : null;
  let loss = 0;
  for (let i = 0; i < train.length; i += 1) {
    const row = train[i];
    const x = features[i];
    const b = sigmoid(parameters[0]);
    let z = 0;
    for (let j = 1; j < parameters.length; j += 1) z += parameters[j] * x[j - 1];
    z = Math.max(-30, Math.min(30, z));
    const q = LN2 * (row.delta / 86400) * Math.pow(2, -z);
    const rawP = b * Math.exp(-q);
    const p = clipProbability(rawP);
    const y = row.pRecall;
    const w = row.sessionSeen;
    loss += w * (-y * Math.log(p) - (1 - y) * Math.log1p(-p));
    if (withGradient && rawP > EPSILON && rawP < 1 - EPSILON && Number.isFinite(q)) {
      const lossDerivative = w * (-y / p + (1 - y) / (1 - p)) / weight;
      gradient[0] += lossDerivative * rawP * (1 - b);
      const zDerivative = lossDerivative * rawP * q * LN2;
      for (let j = 1; j < parameters.length; j += 1) gradient[j] += zDerivative * x[j - 1];
    }
  }
  loss /= weight;
  for (let j = 2; j < parameters.length; j += 1) {
    loss += 0.5 * l2 * parameters[j] ** 2;
    if (withGradient) gradient[j] += l2 * parameters[j];
  }
  return { loss, gradient };
}

function checkHlrScaledGradient(parameters, train, features, weight, l2) {
  const step = 1e-5;
  const analytic = hlrScaledObjectiveAndGradient(parameters, train, features, weight, l2).gradient;
  const numeric = [];
  for (let j = 0; j < parameters.length; j += 1) {
    const upper = parameters.slice();
    const lower = parameters.slice();
    upper[j] += step;
    lower[j] -= step;
    const upperLoss = hlrScaledObjectiveAndGradient(upper, train, features, weight, l2, false).loss;
    const lowerLoss = hlrScaledObjectiveAndGradient(lower, train, features, weight, l2, false).loss;
    numeric.push((upperLoss - lowerLoss) / (2 * step));
  }
  const absoluteErrors = analytic.map((value, j) => Math.abs(value - numeric[j]));
  const relativeErrors = analytic.map((value, j) => (
    Math.abs(value - numeric[j]) / Math.max(1, Math.abs(value), Math.abs(numeric[j]))
  ));
  const scale = Math.max(...analytic.map(Math.abs));
  const direction = analytic.map((value) => -value / Math.max(scale, 1e-12));
  const upper = parameters.map((value, j) => value + step * direction[j]);
  const lower = parameters.map((value, j) => value - step * direction[j]);
  const numericDirectionalDerivative = (
    hlrScaledObjectiveAndGradient(upper, train, features, weight, l2, false).loss
    - hlrScaledObjectiveAndGradient(lower, train, features, weight, l2, false).loss
  ) / (2 * step);
  const analyticDirectionalDerivative = analytic.reduce(
    (sum, value, j) => sum + value * direction[j],
    0,
  );
  const maxAbsError = Math.max(...absoluteErrors);
  const maxRelativeError = Math.max(...relativeErrors);
  const passed = maxAbsError < 1e-5 && numericDirectionalDerivative < 0;
  return {
    method: 'central finite differences at exponential-equivalent initialization',
    step,
    analytic,
    numeric,
    maxAbsError,
    maxRelativeError,
    negativeGradientDirection: direction,
    analyticDirectionalDerivative,
    numericDirectionalDerivative,
    passed,
  };
}

function fitHlrScaled(train, exponentialModel) {
  const statistics = featureStatistics(train);
  const features = train.map((row) => standardizedFeatures(row, statistics));
  const weight = totalWeight(train);
  const lambda = exponentialModel.parameters.lambda;
  const initialParameters = [
    exponentialModel.parameters.a,
    Math.max(-20, Math.min(20, Math.log2(LN2 / lambda))),
    0,
    0,
    0,
    0,
  ];
  const parameters = initialParameters.slice();
  const firstMoment = new Array(parameters.length).fill(0);
  const secondMoment = new Array(parameters.length).fill(0);
  const learningRate = 0.005;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEpsilon = 1e-8;
  const l2 = 1e-4;
  const options = { maxIterations: 700, maxMs: 45000, patience: 120 };
  const deadline = Date.now() + options.maxMs;
  const gradientCheck = checkHlrScaledGradient(parameters, train, features, weight, l2);
  if (!gradientCheck.passed) {
    throw new Error(`hlr_scaled 梯度有限差分校验失败，最大绝对误差 ${gradientCheck.maxAbsError}`);
  }
  const initialEvaluation = hlrScaledObjectiveAndGradient(parameters, train, features, weight, l2);
  const initialLoss = initialEvaluation.loss;
  let bestLoss = initialLoss;
  let bestParameters = parameters.slice();
  let bestIteration = 0;
  let bestGradientNorm = Math.max(...initialEvaluation.gradient.map(Math.abs));
  let iterations = 0;
  let iterationsSinceBest = 0;
  let increasedLossIterations = 0;
  let converged = false;
  let stopReason = 'iteration_limit';
  let previousLoss = initialLoss;
  let lastLoss = initialLoss;

  while (iterations < options.maxIterations) {
    if (Date.now() >= deadline) {
      stopReason = 'time_limit';
      break;
    }
    const evaluation = hlrScaledObjectiveAndGradient(parameters, train, features, weight, l2);
    const { loss, gradient } = evaluation;
    if (!Number.isFinite(loss) || gradient.some((value) => !Number.isFinite(value))) {
      throw new Error(`hlr_scaled 第 ${iterations + 1} 次迭代出现非有限目标或梯度`);
    }
    lastLoss = loss;
    if (loss > previousLoss) increasedLossIterations += 1;
    if (loss < bestLoss - 1e-12) {
      bestLoss = loss;
      bestParameters = parameters.slice();
      bestIteration = iterations + 1;
      bestGradientNorm = Math.max(...gradient.map(Math.abs));
      iterationsSinceBest = 0;
    } else {
      iterationsSinceBest += 1;
    }
    iterations += 1;
    const currentLearningRate = learningRate / (1 + iterations / 300);
    for (let j = 0; j < parameters.length; j += 1) {
      firstMoment[j] = beta1 * firstMoment[j] + (1 - beta1) * gradient[j];
      secondMoment[j] = beta2 * secondMoment[j] + (1 - beta2) * gradient[j] ** 2;
      const correctedFirst = firstMoment[j] / (1 - Math.pow(beta1, iterations));
      const correctedSecond = secondMoment[j] / (1 - Math.pow(beta2, iterations));
      parameters[j] -= currentLearningRate * correctedFirst / (Math.sqrt(correctedSecond) + adamEpsilon);
    }
    previousLoss = loss;
    if (iterations >= 250 && iterationsSinceBest >= options.patience) {
      converged = true;
      stopReason = 'no_improvement';
      break;
    }
  }
  const adamBestLoss = bestLoss;
  const refinementOptions = { maxIterations: 350, maxEvaluations: 2000, maxMs: 30000 };
  const refinement = nelderMead(
    (candidate) => hlrScaledObjectiveAndGradient(candidate, train, features, weight, l2, false).loss,
    bestParameters,
    refinementOptions,
  );
  if (Number.isFinite(refinement.objective) && refinement.objective < bestLoss) {
    bestLoss = refinement.objective;
    bestParameters = refinement.point.slice();
  }
  parameters.splice(0, parameters.length, ...bestParameters);

  return {
    predict: (row, timeDays = row.delta / 86400) => (
      hlrScaledProbability(parameters, standardizedFeatures(row, statistics), timeDays)
    ),
    predictFeatures: (featureVector, timeDays) => (
      hlrScaledProbability(parameters, featureVector, timeDays)
    ),
    trainFeatures: features,
    parameters: {
      a: parameters[0],
      b: sigmoid(parameters[0]),
      theta: parameters.slice(1),
      featureNames: FEATURE_NAMES,
      standardization: statistics,
      halfLifeFormula: 'h=2^(theta·x); p=b*2^(-t/h); b=sigmoid(a)',
    },
    fit: {
      method: 'full-batch Adam + Nelder-Mead refinement with best-parameter restore',
      deterministicInitialization: initialParameters,
      initialization: 'exact fitted-exponential equivalent: a=a_exp, theta0=log2(ln2/lambda_exp), other coefficients zero',
      nestedExponential: {
        lambda,
        halfLife: LN2 / lambda,
        initialTrainLogLoss: initialLoss,
      },
      learningRate,
      learningRateSchedule: 'learningRate/(1+iteration/300)',
      l2,
      regularization: 'L2 on non-intercept theta only; a and theta intercept unpenalized to preserve exponential fallback',
      initialObjective: initialLoss,
      adamBestObjective: adamBestLoss,
      objective: bestLoss,
      lastObjective: lastLoss,
      bestIteration,
      adamBestMaxAbsGradient: bestGradientNorm,
      iterations,
      increasedLossIterations,
      converged: converged || refinement.converged,
      stopReason,
      refinement: {
        method: 'Nelder-Mead',
        objective: refinement.objective,
        iterations: refinement.iterations,
        evaluations: refinement.evaluations,
        converged: refinement.converged,
        stopReason: refinement.stopReason,
        limits: refinementOptions,
      },
      gradientCheck,
      limits: options,
    },
  };
}

function empiricalBins(train) {
  const bins = Array.from({ length: 15 }, (_, index) => ({
    start: index * 2,
    end: (index + 1) * 2,
    weight: 0,
    recall: 0,
    count: 0,
  }));
  for (const row of train) {
    const time = row.delta / 86400;
    if (time < 0 || time > 30) continue;
    const index = Math.min(14, Math.floor(time / 2));
    bins[index].weight += row.sessionSeen;
    bins[index].recall += row.sessionSeen * row.pRecall;
    bins[index].count += 1;
  }
  return bins.filter((bin) => bin.weight > 0).map((bin) => ({
    x: (bin.start + bin.end) / 2,
    y: bin.recall / bin.weight,
    count: bin.count,
    weight: bin.weight,
  }));
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function createSvg(models, train) {
  const title = 'Duolingo 公开复习数据基线（非思迹用户数据）';
  const width = 1100;
  const height = 680;
  const left = 80;
  const top = 105;
  const plotWidth = 700;
  const plotHeight = 450;
  const x = (time) => left + time / 30 * plotWidth;
  const y = (probability) => top + (1 - probability) * plotHeight;
  const colors = {
    constant: '#6b7280',
    exponential: '#2563eb',
    power: '#059669',
    weibull: '#d97706',
    hlr: '#dc2626',
    hlr_scaled: '#7c3aed',
  };
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${xmlEscape(title)}</title>`,
    '<desc>训练集两天经验分箱的加权平均正确率，以及六个拟合模型。HLR 及其带初始回忆率的扩展线是在训练特征分布上的加权平均预测。</desc>',
    '<rect width="100%" height="100%" fill="white"/>',
    `<text x="${width / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="bold">${xmlEscape(title)}</text>`,
    `<text x="${width / 2}" y="70" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#4b5563">训练集经验分箱与拟合曲线；横轴为距上次复习的时间</text>`,
  ];
  for (let tick = 0; tick <= 5; tick += 1) {
    const probability = tick / 5;
    const py = y(probability);
    parts.push(`<line x1="${left}" y1="${py}" x2="${left + plotWidth}" y2="${py}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${left - 12}" y="${py + 5}" text-anchor="end" font-family="sans-serif" font-size="13">${probability.toFixed(1)}</text>`);
  }
  for (let tick = 0; tick <= 30; tick += 5) {
    const px = x(tick);
    parts.push(`<line x1="${px}" y1="${top}" x2="${px}" y2="${top + plotHeight}" stroke="#f3f4f6"/>`);
    parts.push(`<text x="${px}" y="${top + plotHeight + 25}" text-anchor="middle" font-family="sans-serif" font-size="13">${tick}</text>`);
  }
  parts.push(`<line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#111827"/>`);
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#111827"/>`);
  parts.push(`<text x="${left + plotWidth / 2}" y="${top + plotHeight + 58}" text-anchor="middle" font-family="sans-serif" font-size="16">时间（天）</text>`);
  parts.push(`<text x="25" y="${top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 25 ${top + plotHeight / 2})" font-family="sans-serif" font-size="16">回忆正确率</text>`);

  for (const name of MODEL_NAMES) {
    const points = [];
    for (let index = 0; index <= 120; index += 1) {
      const time = index / 4;
      let prediction = 0;
      let weight = 0;
      if (name === 'hlr' || name === 'hlr_scaled') {
        for (let i = 0; i < train.length; i += 1) {
          const w = train[i].sessionSeen;
          prediction += w * models[name].predictFeatures(models[name].trainFeatures[i], time);
          weight += w;
        }
      } else {
        for (const row of train) {
          const w = row.sessionSeen;
          prediction += w * models[name].predict(row, time);
          weight += w;
        }
      }
      points.push(`${x(time).toFixed(2)},${y(prediction / weight).toFixed(2)}`);
    }
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${colors[name]}" stroke-width="2.5"/>`);
  }
  for (const bin of empiricalBins(train)) {
    parts.push(`<circle cx="${x(bin.x).toFixed(2)}" cy="${y(bin.y).toFixed(2)}" r="4.5" fill="#111827" fill-opacity="0.7"><title>${bin.x} 天: ${bin.y.toFixed(4)}；样本 ${bin.count}，权重 ${bin.weight}</title></circle>`);
  }
  parts.push(`<circle cx="825" cy="130" r="5" fill="#111827" fill-opacity="0.7"/><text x="842" y="135" font-family="sans-serif" font-size="14">经验分箱均值</text>`);
  MODEL_NAMES.forEach((name, index) => {
    const py = 170 + index * 34;
    parts.push(`<line x1="810" y1="${py}" x2="838" y2="${py}" stroke="${colors[name]}" stroke-width="3"/><text x="848" y="${py + 5}" font-family="sans-serif" font-size="14">${name}</text>`);
    if (name === 'hlr_scaled') {
      parts.push(`<text x="848" y="${py + 22}" font-family="sans-serif" font-size="12" fill="#4b5563">带初始回忆率的 HLR 扩展</text>`);
    }
  });
  parts.push('<text x="810" y="400" font-family="sans-serif" font-size="12" fill="#4b5563">圆点：训练集每 2 天</text>');
  parts.push('<text x="810" y="420" font-family="sans-serif" font-size="12" fill="#4b5563">session_seen 加权均值</text>');
  parts.push('<text x="810" y="450" font-family="sans-serif" font-size="12" fill="#4b5563">HLR / hlr_scaled：训练特征</text>');
  parts.push('<text x="810" y="470" font-family="sans-serif" font-size="12" fill="#4b5563">分布上的总体平均预测</text>');
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

function csvEscape(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writePredictions(outputPath, test, models) {
  const columns = [
    'p_recall',
    'timestamp',
    'delta',
    'user_id',
    'lexeme_id',
    'history_seen',
    'history_correct',
    'session_seen',
    'session_correct',
    'split',
    ...MODEL_NAMES.map((name) => `prediction_${name}`),
  ];
  const descriptor = fs.openSync(outputPath, 'w');
  try {
    fs.writeSync(descriptor, `${columns.join(',')}\n`);
    let chunk = [];
    for (const row of test) {
      const values = [
        row.pRecall,
        row.timestamp,
        row.delta,
        row.userId,
        row.lexemeId,
        row.historySeen,
        row.historyCorrect,
        row.sessionSeen,
        row.sessionCorrect,
        row.split,
        ...MODEL_NAMES.map((name) => clipProbability(models[name].predict(row))),
      ];
      chunk.push(values.map(csvEscape).join(','));
      if (chunk.length >= 1000) {
        fs.writeSync(descriptor, `${chunk.join('\n')}\n`);
        chunk = [];
      }
    }
    if (chunk.length) fs.writeSync(descriptor, `${chunk.join('\n')}\n`);
  } finally {
    fs.closeSync(descriptor);
  }
}

function formatMetric(value) {
  return value === null ? 'n/a' : value.toFixed(6);
}

function createModelCard(inputPath, train, test, metrics) {
  const lines = [
    '# Duolingo Half-Life Regression 基线模型卡',
    '',
    '## 数据来源与抽样文件',
    '',
    '- 来源：Duolingo Half-Life Regression 项目的公开语言学习复习轨迹数据（`learning_traces.13m`），项目地址：https://github.com/duolingo/halflife-regression 。',
    `- 本次输入抽样文件：\`${inputPath}\`。训练集 ${train.length} 行，测试集 ${test.length} 行；沿用文件中按 user_id 划分的 train/test，不再次划分。`,
    '- 这是公开语言复习 session 数据，不是思迹用户数据，也不是思迹原思路断片数据。结果不能用于弹窗或任何直接干预。',
    '',
    '## 目标、权重与特征',
    '',
    '以 `p_recall` 为比例目标，以 `session_seen` 为样本权重。加权负对数似然为 `session_seen × [-y log(p) - (1-y) log(1-p)]` 的平均值。所有预测均裁剪到 `[1e-6, 1-1e-6]`。`t=delta/86400`，单位为天。',
    '',
    '- constant：`p=b`，其中 `b` 是训练集加权平均正确率。',
    '- exponential：`p=b exp(-λt)`，`b=sigmoid(a)`，`λ=exp(logλ)`。',
    '- power：`p=b(1+γt)^(-β)`，`b=sigmoid(a)`，`γ=exp(logγ)`，`β=exp(logβ)`。',
    '- weibull：`p=b exp(-(λt)^k)`，`b=sigmoid(a)`，`λ=exp(logλ)`，`k=exp(logk)`。',
    '- HLR：`p=2^(-t/h)`，`h=2^(θ·x)`；`x=[1,log1p(history_seen),log1p(history_correct),log1p(max(0,history_seen-history_correct)),log1p(session_seen)]`。非截距特征按训练集的加权均值和标准差标准化，非截距参数使用 L2 正则。',
    '- hlr_scaled：带初始回忆率的 HLR 扩展，`p=b×2^(-t/h)`，`b=sigmoid(a)`，`h=2^(θ·x)`，使用与 HLR 相同的标准化特征。它保留原 HLR 作为对照，并包含 exponential 作为非截距系数均为零的特例。',
    '',
    '三个参数曲线使用确定性初始化的自写 Nelder–Mead；HLR 与 hlr_scaled 先用全批量 Adam，再以同一目标做 Nelder–Mead 精修。HLR 初始截距由加权平均时间和正确率推算；hlr_scaled 从已拟合 exponential 的等价参数初始化，即 `a=a_exp`、`θ0=log2(ln2/λ_exp)`。两个模型都在训练前用中心有限差分检查全部参数的梯度及负梯度方向，Adam 逐步降低学习率，最终恢复两阶段中训练目标最优的参数。',
    '',
    'hlr_scaled 仅对非截距 θ 使用 L2；`a` 和 θ 截距不惩罚，以保留无正则偏置的 exponential 回退点。半衰期线性预测限制在数值安全范围。近乎平坦的数据对 `b` 有约束，但对很大的 `h` 可能只有弱识别，因此需结合初始化和参数诊断解读，不能把训练改善等同于因果证据。',
    '',
    '## 指标',
    '',
    '- weighted logloss：上述比例目标的加权负对数似然，越低越好。',
    '- weighted Brier：`session_seen` 加权的 `(p-y)^2` 均值，越低越好。',
    '- weighted ROC AUC：每行以 `session_correct` 为正例权重、`session_seen-session_correct` 为负例权重，同分预测按 0.5 计，越高越好。',
    '- 校准分箱：按预测概率划分为 10 个等宽区间，报告样本数、权重、平均预测和观测正确率。完整数值见 `metrics.json`。',
    '',
    '| 模型 | 数据 | Logloss | Brier | AUC |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  for (const name of MODEL_NAMES) {
    for (const split of ['train', 'test']) {
      const score = metrics.models[name][split];
      lines.push(`| ${name} | ${split} | ${formatMetric(score.weightedLogLoss)} | ${formatMetric(score.weightedBrier)} | ${formatMetric(score.weightedAuc)} |`);
    }
  }
  lines.push(
    '',
    '## 文件与图示',
    '',
    '- `predictions.csv`：每个测试样本一行，包含六个模型的预测。',
    '- `forgetting-curves.svg`：0–30 天的训练集经验分箱均值和六条拟合线。经验点按 2 天分箱并用 `session_seen` 加权；HLR 与 hlr_scaled 线是在训练特征分布上的加权平均预测，并非某一用户的个性化曲线。',
    '',
    '## 限制',
    '',
    '- 公开 Duolingo 数据的任务、时间间隔和用户行为与思迹场景不同，不能据此推断思迹用户的遗忘规律。',
    '- 这是抽样 observational（观察性）拟合，不代表因果效应；测试表现依赖给定用户划分及抽样代表性。',
    '- `p_recall` 是 session 比例而非逐次尝试标签；Brier 和比例 NLL 使用比例目标，AUC 使用 session 正/负次数权重。',
    '- 原 HLR 强制 `p(0)=1`，不以 constant 为特例；即使训练目标正常下降也可能因模型形式不匹配而差于 constant，保留其结果作为对照。',
    '- hlr_scaled 的 exponential 回退只保证训练目标有可靠起点，不保证测试集一定优于其他模型；平坦数据中的半衰期及特征系数可能弱识别。',
    '- constant 不含时间项，图中为水平线；HLR 系列的总体平均曲线会掩盖特征异质性。',
    '- 本工具只做离线研究评估，不得连接或用于弹窗、提醒及其他面向用户的干预。',
    '',
  );
  return lines.join('\n');
}

function run(inputArgument, outputArgument) {
  const inputPath = path.resolve(inputArgument);
  const outputPath = path.resolve(outputArgument);
  const { train, test } = readDataset(inputPath);
  const models = {};
  const constant = weightedMeanRecall(train);
  models.constant = {
    predict: () => constant,
    parameters: { p: constant },
    fit: { method: 'closed-form weighted mean' },
  };
  for (const name of ['exponential', 'power', 'weibull']) models[name] = fitCurve(name, train);
  models.hlr = fitHlr(train);
  models.hlr_scaled = fitHlrScaled(train, models.exponential);

  const metrics = {
    inputFile: inputPath,
    target: 'p_recall',
    sampleWeight: 'session_seen',
    probabilityClip: [EPSILON, 1 - EPSILON],
    train: { sampleCount: train.length, totalWeight: totalWeight(train) },
    test: { sampleCount: test.length, totalWeight: totalWeight(test) },
    models: {},
  };
  for (const name of MODEL_NAMES) {
    const trainEvaluation = evaluateRows(train, models[name].predict);
    const testEvaluation = evaluateRows(test, models[name].predict);
    const cleanEvaluation = (evaluation) => ({
      weightedLogLoss: evaluation.weightedLogLoss,
      weightedBrier: evaluation.weightedBrier,
      weightedAuc: evaluation.weightedAuc,
      sampleCount: evaluation.sampleCount,
      totalWeight: evaluation.totalWeight,
      positiveWeight: evaluation.positiveWeight,
      negativeWeight: evaluation.negativeWeight,
      calibration: evaluation.calibration,
    });
    metrics.models[name] = {
      parameters: models[name].parameters,
      fit: models[name].fit,
      train: cleanEvaluation(trainEvaluation),
      test: cleanEvaluation(testEvaluation),
    };
  }

  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(metricsPath(outputPath), `${JSON.stringify(metrics, null, 2)}\n`);
  writePredictions(path.join(outputPath, 'predictions.csv'), test, models);
  fs.writeFileSync(path.join(outputPath, 'forgetting-curves.svg'), createSvg(models, train));
  fs.writeFileSync(path.join(outputPath, 'model-card.md'), createModelCard(inputPath, train, test, metrics));
  return { metrics, outputPath };
}

function metricsPath(outputPath) {
  return path.join(outputPath, 'metrics.json');
}

function main(arguments_) {
  if (arguments_.length !== 2) {
    throw new Error('用法: node fit-baselines.js <baseline-sample.csv> <输出目录>');
  }
  const result = run(arguments_[0], arguments_[1]);
  process.stdout.write(`完成：${result.metrics.models ? MODEL_NAMES.length : 0} 个模型；输出目录 ${result.outputPath}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`fit-baselines: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_COLUMNS,
  MODEL_NAMES,
  readDataset,
  run,
};
