import { validateEvaluationSpec, type EvaluationReport, type EvaluationSpec, type EvaluationStep } from '@common/interfaces';
import { evaluationSpecHash } from './evaluation-key.js';

export function validateEvaluationReport(value: unknown, expected?: EvaluationSpec): asserts value is EvaluationReport {
  if (!value || typeof value !== 'object') throw new Error('Invalid evaluation report');
  const report = value as EvaluationReport;
  if (report.schemaVersion !== 1 || !['live', 'fixture'].includes(report.source) || typeof report.jobId !== 'string') throw new Error('Invalid report identity');
  validateEvaluationSpec(report.spec);
  if (report.specHash !== evaluationSpecHash(report.spec) || (expected && report.specHash !== evaluationSpecHash(expected))) throw new Error('Report does not match requested evaluation');
  const dates = [report.startedAt, report.completedAt, report.freshUntil].map(Date.parse);
  if (dates.some(n => !Number.isFinite(n)) || dates[0]! > dates[1]! || dates[1]! > dates[2]!) throw new Error('Invalid report timestamps');
  if (!Array.isArray(report.tasks) || report.tasks.length !== report.spec.models.length * report.spec.taskIds.length * report.spec.repetitions) throw new Error('Incomplete evaluation report');
  const seen = new Set<string>();
  const number = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  for (const task of report.tasks) {
    const model = report.spec.models.find(m => m.id === task.modelId && m.revision === task.modelRevision);
    if (!model || !report.spec.taskIds.includes(task.taskId) || !number(task.repetition) || task.repetition >= report.spec.repetitions) throw new Error('Unexpected report task');
    const key = JSON.stringify([task.modelId, task.taskId, task.repetition]);
    if (seen.has(key)) throw new Error('Duplicate report task');
    seen.add(key);
    if (!['passed', 'failed', 'infrastructure_error'].includes(task.outcome)) throw new Error('Unknown task outcome');
    if (![task.durationMs, task.inputTokens, task.outputTokens].every(number)) throw new Error('Invalid report measurement');
    if (!Array.isArray(task.checks) || !Array.isArray(task.steps) || task.steps.length > report.spec.maxSteps) throw new Error('Invalid task evidence');
    if (task.checks.some((c: {name: string; passed: boolean}) => typeof c.name !== 'string' || typeof c.passed !== 'boolean')) throw new Error('Invalid check evidence');
    if (task.outcome === 'passed' && (!task.checks.length || !task.checks.every((c: {passed: boolean}) => c.passed))) throw new Error('Passing task requires passing checks');
    if (task.steps.some((s: EvaluationStep, i: number) => s.step !== i + 1 || ![s.durationMs, s.inputTokens, s.outputTokens].every(number))) throw new Error('Invalid step evidence');
    if (task.inputTokens !== task.steps.reduce((n: number,s: EvaluationStep) => n+s.inputTokens,0) || task.outputTokens !== task.steps.reduce((n: number,s: EvaluationStep) => n+s.outputTokens,0)) throw new Error('Token totals disagree with steps');
    for (const artifact of [task.traceId, task.screenshotId]) if (artifact !== undefined && !/^[a-f0-9]{64}\.(png|zip)$/.test(artifact)) throw new Error('Invalid artifact reference');
  }
}

export function summarizeEvaluation(report: EvaluationReport) {
  validateEvaluationReport(report);
  return report.spec.models.map(model => {
    const tasks = report.tasks.filter(t => t.modelId === model.id);
    const measured = tasks.filter(t => t.outcome !== 'infrastructure_error');
    const passed = measured.filter(t => t.outcome === 'passed').length;
    return { modelId: model.id, revision: model.revision, quantization: model.quantization,
      passed, attempted: measured.length, infrastructureErrors: tasks.length - measured.length,
      passRate: measured.length ? passed / measured.length : null,
      durationMs: tasks.reduce((n,t) => n+t.durationMs,0),
      inputTokens: tasks.reduce((n,t) => n+t.inputTokens,0), outputTokens: tasks.reduce((n,t) => n+t.outputTokens,0),
    };
  });
}
