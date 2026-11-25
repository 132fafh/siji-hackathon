# Duolingo Half-Life Regression 基线模型卡

## 数据来源与抽样文件

- 来源：Duolingo Half-Life Regression 项目的公开语言学习复习轨迹数据（`learning_traces.13m`），项目地址：https://github.com/duolingo/halflife-regression 。
- 本次输入抽样文件：`D:\Kimi\siji-research\baseline-sample.csv`。训练集 205844 行，测试集 51241 行；沿用文件中按 user_id 划分的 train/test，不再次划分。
- 这是公开语言复习 session 数据，不是思迹用户数据，也不是思迹原思路断片数据。结果不能用于弹窗或任何直接干预。

## 目标、权重与特征

以 `p_recall` 为比例目标，以 `session_seen` 为样本权重。加权负对数似然为 `session_seen × [-y log(p) - (1-y) log(1-p)]` 的平均值。所有预测均裁剪到 `[1e-6, 1-1e-6]`。`t=delta/86400`，单位为天。

- constant：`p=b`，其中 `b` 是训练集加权平均正确率。
- exponential：`p=b exp(-λt)`，`b=sigmoid(a)`，`λ=exp(logλ)`。
- power：`p=b(1+γt)^(-β)`，`b=sigmoid(a)`，`γ=exp(logγ)`，`β=exp(logβ)`。
- weibull：`p=b exp(-(λt)^k)`，`b=sigmoid(a)`，`λ=exp(logλ)`，`k=exp(logk)`。
- HLR：`p=2^(-t/h)`，`h=2^(θ·x)`；`x=[1,log1p(history_seen),log1p(history_correct),log1p(max(0,history_seen-history_correct)),log1p(session_seen)]`。非截距特征按训练集的加权均值和标准差标准化，非截距参数使用 L2 正则。
- hlr_scaled：带初始回忆率的 HLR 扩展，`p=b×2^(-t/h)`，`b=sigmoid(a)`，`h=2^(θ·x)`，使用与 HLR 相同的标准化特征。它保留原 HLR 作为对照，并包含 exponential 作为非截距系数均为零的特例。

三个参数曲线使用确定性初始化的自写 Nelder–Mead；HLR 与 hlr_scaled 先用全批量 Adam，再以同一目标做 Nelder–Mead 精修。HLR 初始截距由加权平均时间和正确率推算；hlr_scaled 从已拟合 exponential 的等价参数初始化，即 `a=a_exp`、`θ0=log2(ln2/λ_exp)`。两个模型都在训练前用中心有限差分检查全部参数的梯度及负梯度方向，Adam 逐步降低学习率，最终恢复两阶段中训练目标最优的参数。

hlr_scaled 仅对非截距 θ 使用 L2；`a` 和 θ 截距不惩罚，以保留无正则偏置的 exponential 回退点。半衰期线性预测限制在数值安全范围。近乎平坦的数据对 `b` 有约束，但对很大的 `h` 可能只有弱识别，因此需结合初始化和参数诊断解读，不能把训练改善等同于因果证据。

## 指标

- weighted logloss：上述比例目标的加权负对数似然，越低越好。
- weighted Brier：`session_seen` 加权的 `(p-y)^2` 均值，越低越好。
- weighted ROC AUC：每行以 `session_correct` 为正例权重、`session_seen-session_correct` 为负例权重，同分预测按 0.5 计，越高越好。
- 校准分箱：按预测概率划分为 10 个等宽区间，报告样本数、权重、平均预测和观测正确率。完整数值见 `metrics.json`。

| 模型 | 数据 | Logloss | Brier | AUC |
| --- | --- | ---: | ---: | ---: |
| constant | train | 0.315966 | 0.052002 | 0.500000 |
| constant | test | 0.314246 | 0.050740 | 0.500000 |
| exponential | train | 0.315723 | 0.051960 | 0.530518 |
| exponential | test | 0.314056 | 0.050710 | 0.530993 |
| power | train | 0.315419 | 0.051906 | 0.530518 |
| power | test | 0.313751 | 0.050654 | 0.530993 |
| weibull | train | 0.327818 | 0.054268 | 0.530518 |
| weibull | test | 0.326120 | 0.053037 | 0.530993 |
| hlr | train | 0.595925 | 0.071918 | 0.549762 |
| hlr | test | 0.598198 | 0.070571 | 0.544768 |
| hlr_scaled | train | 0.314815 | 0.051818 | 0.565434 |
| hlr_scaled | test | 0.313311 | 0.050602 | 0.557447 |

## 文件与图示

- `predictions.csv`：每个测试样本一行，包含六个模型的预测。
- `forgetting-curves.svg`：0–30 天的训练集经验分箱均值和六条拟合线。经验点按 2 天分箱并用 `session_seen` 加权；HLR 与 hlr_scaled 线是在训练特征分布上的加权平均预测，并非某一用户的个性化曲线。

## 限制

- 公开 Duolingo 数据的任务、时间间隔和用户行为与思迹场景不同，不能据此推断思迹用户的遗忘规律。
- 这是抽样 observational（观察性）拟合，不代表因果效应；测试表现依赖给定用户划分及抽样代表性。
- `p_recall` 是 session 比例而非逐次尝试标签；Brier 和比例 NLL 使用比例目标，AUC 使用 session 正/负次数权重。
- 原 HLR 强制 `p(0)=1`，不以 constant 为特例；即使训练目标正常下降也可能因模型形式不匹配而差于 constant，保留其结果作为对照。
- hlr_scaled 的 exponential 回退只保证训练目标有可靠起点，不保证测试集一定优于其他模型；平坦数据中的半衰期及特征系数可能弱识别。
- constant 不含时间项，图中为水平线；HLR 系列的总体平均曲线会掩盖特征异质性。
- 本工具只做离线研究评估，不得连接或用于弹窗、提醒及其他面向用户的干预。
