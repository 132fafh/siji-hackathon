'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MODEL_NAMES, REQUIRED_COLUMNS, readDataset } = require('./fit-baselines');

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function syntheticCsv() {
  const random = mulberry32(20261109);
  const lines = [REQUIRED_COLUMNS.join(',')];
  let testRows = 0;
  for (let user = 0; user < 20; user += 1) {
    const split = user < 16 ? 'train' : 'test';
    for (let review = 0; review < 12; review += 1) {
      const historySeen = review + Math.floor(random() * 8);
      const historyCorrect = Math.min(historySeen, Math.floor(historySeen * (0.45 + random() * 0.5)));
      const sessionSeen = 2 + Math.floor(random() * 10);
      const days = 0.05 + random() * 29.95;
      const feature = Math.log1p(historyCorrect) - 0.45 * Math.log1p(historySeen - historyCorrect);
      const probability = Math.max(0.02, Math.min(0.98, 0.92 * Math.exp(-days / (8 * Math.exp(0.2 * feature)))));
      let sessionCorrect = 0;
      for (let attempt = 0; attempt < sessionSeen; attempt += 1) {
        if (random() < probability) sessionCorrect += 1;
      }
      const pRecall = sessionCorrect / sessionSeen;
      const timestamp = 1451606400 + user * 100000 + review * Math.round(days * 86400);
      const values = [
        pRecall,
        timestamp,
        days * 86400,
        `user-${user}`,
        `lexeme-${review % 7}`,
        historySeen,
        historyCorrect,
        sessionSeen,
        sessionCorrect,
        split,
      ];
      lines.push(values.join(','));
      if (split === 'test') testRows += 1;
    }
  }
  return { text: `${lines.join('\n')}\n`, testRows };
}

function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(__dirname, '.synthetic-smoke-'));
  const inputPath = path.join(temporaryRoot, 'sample.csv');
  const outputPath = path.join(temporaryRoot, 'out');
  try {
    const synthetic = syntheticCsv();
    fs.writeFileSync(inputPath, synthetic.text);
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'fit-baselines.js'), inputPath, outputPath],
      { cwd: __dirname, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    );
    assert.equal(result.error, undefined, result.error && result.error.message);
    assert.equal(result.status, 0, `训练脚本失败：\n${result.stdout}\n${result.stderr}`);

    for (const file of ['metrics.json', 'predictions.csv', 'forgetting-curves.svg', 'model-card.md']) {
      assert.ok(fs.statSync(path.join(outputPath, file)).size > 0, `${file} 为空或不存在`);
    }
    const metrics = JSON.parse(fs.readFileSync(path.join(outputPath, 'metrics.json'), 'utf8'));
    assert.deepEqual(Object.keys(metrics.models), MODEL_NAMES);
    for (const name of MODEL_NAMES) {
      for (const split of ['train', 'test']) {
        const score = metrics.models[name][split];
        assert.ok(Number.isFinite(score.weightedLogLoss), `${name}/${split} logloss 非有限值`);
        assert.ok(Number.isFinite(score.weightedBrier), `${name}/${split} Brier 非有限值`);
        assert.ok(score.weightedAuc >= 0 && score.weightedAuc <= 1, `${name}/${split} AUC 越界`);
        assert.equal(score.calibration.length, 10);
      }
    }
    const hlr = metrics.models.hlr;
    const hlrFit = hlr.fit;
    const statistics = hlr.parameters.standardization;
    const { train } = readDataset(inputPath);
    const trainWeight = train.reduce((sum, row) => sum + row.sessionSeen, 0);
    const rawFeatures = train.map((row) => [
      1,
      Math.log1p(row.historySeen),
      Math.log1p(row.historyCorrect),
      Math.log1p(Math.max(0, row.historySeen - row.historyCorrect)),
      Math.log1p(row.sessionSeen),
    ]);
    for (let j = 1; j < 5; j += 1) {
      let mean = 0;
      let variance = 0;
      for (let i = 0; i < train.length; i += 1) mean += train[i].sessionSeen * rawFeatures[i][j] / trainWeight;
      for (let i = 0; i < train.length; i += 1) {
        variance += train[i].sessionSeen * (rawFeatures[i][j] - mean) ** 2 / trainWeight;
      }
      assert.ok(Math.abs(statistics.means[j] - mean) < 1e-10, `HLR 特征 ${j} 加权均值错误`);
      assert.ok(Math.abs(statistics.scales[j] - Math.sqrt(variance)) < 1e-10, `HLR 特征 ${j} 标准差错误`);
    }
    assert.ok(hlrFit.gradientCheck.passed, 'HLR 梯度诊断未通过');
    assert.ok(hlrFit.gradientCheck.maxAbsError < 1e-5, 'HLR 解析梯度与有限差分不一致');
    assert.ok(hlrFit.gradientCheck.numericDirectionalDerivative < 0, 'HLR 负梯度方向不是下降方向');
    assert.ok(hlrFit.objective <= hlrFit.initialObjective + 1e-10, 'HLR 最佳目标差于初始化');
    assert.ok(hlrFit.objective <= hlrFit.lastObjective + 1e-10, 'HLR 未恢复历史最佳参数');
    assert.ok(hlrFit.objective <= hlrFit.adamBestObjective + 1e-10, 'HLR 精修结果差于 Adam 最佳点');
    assert.ok(hlrFit.refinement.evaluations > 0, 'HLR 精修诊断缺失');
    assert.ok(hlrFit.bestIteration > 0, 'HLR 没有任何有效优化迭代');
    const regularizedTrainLoss = hlr.train.weightedLogLoss + hlr.parameters.theta.slice(1).reduce(
      (sum, value) => sum + 0.5 * hlrFit.l2 * value ** 2,
      0,
    );
    assert.ok(
      Math.abs(regularizedTrainLoss - hlrFit.objective) < 1e-10,
      'HLR 输出参数与最佳训练目标不一致',
    );
    assert.ok(
      hlr.test.weightedLogLoss < metrics.models.constant.test.weightedLogLoss,
      'HLR 在含真实遗忘信号的合成数据上异常差于 constant',
    );
    const scaled = metrics.models.hlr_scaled;
    const scaledFit = scaled.fit;
    assert.ok(scaledFit.gradientCheck.passed, 'hlr_scaled 梯度诊断未通过');
    assert.ok(scaledFit.gradientCheck.maxAbsError < 1e-5, 'hlr_scaled 解析梯度与有限差分不一致');
    assert.ok(scaledFit.gradientCheck.numericDirectionalDerivative < 0, 'hlr_scaled 负梯度方向不是下降方向');
    assert.ok(scaledFit.objective <= scaledFit.initialObjective + 1e-10, 'hlr_scaled 最佳目标差于初始化');
    assert.ok(scaledFit.objective <= scaledFit.adamBestObjective + 1e-10, 'hlr_scaled 精修结果差于 Adam 最佳点');
    assert.ok(scaledFit.refinement.evaluations > 0, 'hlr_scaled 精修诊断缺失');
    assert.ok(
      Math.abs(scaledFit.initialObjective - metrics.models.exponential.train.weightedLogLoss) < 1e-10,
      'hlr_scaled 初始化没有严格复现 exponential',
    );
    assert.ok(
      scaled.train.weightedLogLoss <= metrics.models.exponential.train.weightedLogLoss + 1e-10,
      'hlr_scaled 丢失了 exponential 回退解',
    );
    const scaledRegularizedTrainLoss = scaled.train.weightedLogLoss + scaled.parameters.theta.slice(1).reduce(
      (sum, value) => sum + 0.5 * scaledFit.l2 * value ** 2,
      0,
    );
    assert.ok(
      Math.abs(scaledRegularizedTrainLoss - scaledFit.objective) < 1e-10,
      'hlr_scaled 输出参数与最佳训练目标不一致',
    );
    assert.ok(
      scaled.test.weightedLogLoss < metrics.models.constant.test.weightedLogLoss,
      'hlr_scaled 在合成数据上异常差于 constant',
    );
    const predictions = fs.readFileSync(path.join(outputPath, 'predictions.csv'), 'utf8').trim().split(/\r?\n/);
    assert.equal(predictions.length, synthetic.testRows + 1, 'predictions.csv 测试行数不正确');
    assert.ok(predictions[0].endsWith(MODEL_NAMES.map((name) => `prediction_${name}`).join(',')));
    const svg = fs.readFileSync(path.join(outputPath, 'forgetting-curves.svg'), 'utf8');
    assert.ok(svg.includes('Duolingo 公开复习数据基线（非思迹用户数据）'));
    for (const name of MODEL_NAMES) assert.ok(svg.includes(`>${name}</text>`), `SVG 缺少 ${name} 图例`);
    assert.ok(svg.includes('带初始回忆率的 HLR 扩展'), 'SVG 未说明 hlr_scaled 含义');
    const card = fs.readFileSync(path.join(outputPath, 'model-card.md'), 'utf8');
    assert.ok(card.includes('不是思迹原思路断片数据'));
    assert.ok(card.includes('不能用于弹窗'));
    assert.ok(card.includes('hlr_scaled：带初始回忆率的 HLR 扩展'));
    process.stdout.write(
      `合成验证通过：240 行输入，${synthetic.testRows} 行测试预测，${MODEL_NAMES.length} 个模型及 4 个输出文件均有效。\n`,
    );
    for (const name of MODEL_NAMES) {
      const score = metrics.models[name].test;
      process.stdout.write(`${name}: logloss=${score.weightedLogLoss.toFixed(6)}, Brier=${score.weightedBrier.toFixed(6)}, AUC=${score.weightedAuc.toFixed(6)}\n`);
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`synthetic-smoke: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
