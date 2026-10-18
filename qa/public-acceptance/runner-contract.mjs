import {createHash} from 'node:crypto';

export const FULL_PDF_FIXTURE = Object.freeze({
  path: 'qa/public-acceptance/fixtures/tracemonkey-original.pdf',
  bytes: 1016315,
  sha256: '3662ff519e485810520552bf301d8c3b2b917fd2f83303f4965d7abed367e113',
});

const scenarios = {
  full: {
    args: ['qa/public-acceptance/run.mjs', '--run'],
    passState: 'PUBLIC_OPENAI_PROTOCOL_PASSED',
    // Preserve both actual output recordings before selecting screenshots.
    media: ['A-actual-browser-output.webm', 'B-actual-browser-output.webm',
      'A-original-source-box-and-ellipse.png', 'B-video-source-annotation.png',
      'A-converted-slide-1.png', 'A-converted-slide-2.png', 'A-converted-slide-1-return.png',
      'B-revised-focused-whiteboard.png', 'A-active-mobile-390.png', 'B-synthetic-microphone-response.png',
      'A-failure.png', 'B-failure.png', 'C-failure.png'],
  },
  remaining: {
    args: ['qa/public-acceptance/run.mjs', '--remaining', '--run'],
    passState: 'PUBLIC_REMAINING_SCENARIOS_PASSED',
    media: ['R-revised-focused-whiteboard.png', 'R-converted-slide-1-return.png',
      'R-active-mobile-390.png', 'R-synthetic-microphone-response.png', 'R-actual-browser-output.webm'],
  },
  'research-recovery': {
    args: ['qa/public-acceptance/research-recovery.mjs', '--run'],
    passState: 'PUBLIC_RESEARCH_REFRESH_RECOVERY_PASSED',
    media: [],
  },
};
for (const value of Object.values(scenarios)) {
  Object.freeze(value.args); Object.freeze(value.media); Object.freeze(value);
}

export function acceptanceScenario(name) {
  if (!Object.hasOwn(scenarios, name)) throw Error('Invalid immutable public scenario.');
  return scenarios[name];
}

const runners = Object.freeze({
  'ubuntu-24.04': Object.freeze({label: 'ubuntu-24.04', platform: 'linux', runnerOS: 'Linux'}),
  'windows-2025': Object.freeze({label: 'windows-2025', platform: 'win32', runnerOS: 'Windows'}),
});
export function acceptanceRunner(name, platform, runnerOS) {
  if (!Object.hasOwn(runners, name)) throw Error('Choose an approved standard public runner.');
  const value = runners[name];
  if (value.platform !== platform || value.runnerOS !== runnerOS) throw Error('Public runner does not match its fixed platform.');
  return value;
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyFullPdf(bytes) {
  if (bytes.length !== FULL_PDF_FIXTURE.bytes || digest(bytes) !== FULL_PDF_FIXTURE.sha256) {
    throw Error('The full protocol requires the approved original PDF bytes.');
  }
}

export function verifyExportMedia(scenario, name, bytes, report) {
  if (!acceptanceScenario(scenario).media.includes(name)) throw Error('Media is outside the scenario export allowlist.');
  if (name.endsWith('.webm')) {
    const visitor = name.split('-')[0], receipt = report.visitors?.[visitor]?.renderedRecording;
    if (!receipt || bytes.length !== receipt.bytes || digest(bytes) !== receipt.sha256) {
      throw Error('Browser-output recording does not match its visitor report hash and size.');
    }
  }
}
