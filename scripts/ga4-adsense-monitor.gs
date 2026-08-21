const CONFIG = {
  githubOwner: 'ecoliving-tips',
  githubRepository: 'ecoliving-tips.github.io',
  githubWorkflowId: '335601450',

  // The workflow file must exist on this branch.
  // Change to 'main' after pushing the workflow to main.
  githubBranch: 'feature/unified-song-library',

  // GA4 active users are an alert signal, not proof of invalid AdSense traffic.
  // Two consecutive high readings activate the global emergency safeguard.
  autoTriggerEmergency: true,

  // Singapore is the country currently showing the suspicious spike.
  monitoredCountries: ['Singapore'],
  combinedTrafficThreshold: 50,

  // Restore normal mode only after traffic falls this low.
  recoveryThreshold: 15,

  // Consecutive readings prevent reacting to one transient sample.
  requiredHighReadings: 2,
  requiredLowReadings: 3,

  // Prevent repeated emails during one traffic wave.
  alertCooldownMinutes: 30,

  ga4PropertyId: '529170281',
  alertEmail: 'vineethwilson15@gmail.com'
};

function checkSingaporeTraffic() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    console.log('Another check is already running.');
    return;
  }

  try {
    const traffic = getMonitoredActiveUsers();

    // A GA4/API failure must never be treated as zero traffic.
    if (!traffic.available) {
      console.log('GA4 traffic data unavailable; no mode change.');
      return;
    }

    const users = traffic.total;
    const properties = PropertiesService.getScriptProperties();
    const now = Date.now();

    const highReadings = Number(
      properties.getProperty('SINGAPORE_HIGH_READINGS') || '0'
    );

    const lowReadings = Number(
      properties.getProperty('SINGAPORE_LOW_READINGS') || '0'
    );

    const lastAlertAt = Number(
      properties.getProperty('LAST_ALERT_AT') || '0'
    );

    const currentMode =
      properties.getProperty('LAST_TRIGGERED_MODE') || 'normal';

    console.log(`Combined monitored active users: ${users}`);
    console.log(`Current AdSense mode: ${currentMode}`);
    console.log(`Country breakdown: ${JSON.stringify(traffic.breakdown)}`);

    if (users >= CONFIG.combinedTrafficThreshold) {
      const confirmedHighReadings = Math.min(
        highReadings + 1,
        CONFIG.requiredHighReadings
      );

      properties.setProperty(
        'SINGAPORE_HIGH_READINGS',
        String(confirmedHighReadings)
      );
      properties.setProperty('SINGAPORE_LOW_READINGS', '0');

      console.log(
        `High reading ${confirmedHighReadings}/` +
        `${CONFIG.requiredHighReadings}`
      );

      const cooldownElapsed =
        now - lastAlertAt >= CONFIG.alertCooldownMinutes * 60 * 1000;

      if (cooldownElapsed) {
        sendTrafficAlert(users, traffic.breakdown);
        properties.setProperty('LAST_ALERT_AT', String(now));
      }

      if (
        CONFIG.autoTriggerEmergency &&
        currentMode !== 'emergency' &&
        confirmedHighReadings >= CONFIG.requiredHighReadings
      ) {
        triggerGitHubWorkflow('emergency');
        properties.setProperty('LAST_TRIGGERED_MODE', 'emergency');
        properties.setProperty('SINGAPORE_LOW_READINGS', '0');

        console.log('Emergency AdSense mode activated automatically.');
      }

      return;
    }

    properties.setProperty('SINGAPORE_HIGH_READINGS', '0');

    if (users <= CONFIG.recoveryThreshold) {
      const confirmedLowReadings = Math.min(
        lowReadings + 1,
        CONFIG.requiredLowReadings
      );

      properties.setProperty(
        'SINGAPORE_LOW_READINGS',
        String(confirmedLowReadings)
      );

      console.log(
        `Low reading ${confirmedLowReadings}/` +
        `${CONFIG.requiredLowReadings}`
      );

      if (
        CONFIG.autoTriggerEmergency &&
        currentMode === 'emergency' &&
        confirmedLowReadings >= CONFIG.requiredLowReadings
      ) {
        triggerGitHubWorkflow('normal');
        properties.setProperty('LAST_TRIGGERED_MODE', 'normal');
        properties.setProperty('SINGAPORE_LOW_READINGS', '0');
        properties.setProperty('SINGAPORE_HIGH_READINGS', '0');

        console.log('Normal AdSense mode restored automatically.');
      }

      return;
    }

    // Traffic between thresholds is neither an attack confirmation nor recovery.
    properties.setProperty('SINGAPORE_LOW_READINGS', '0');

    console.log(
      `Traffic is between thresholds: ${CONFIG.recoveryThreshold} and ` +
      `${CONFIG.combinedTrafficThreshold}. No mode change.`
    );
  } finally {
    lock.releaseLock();
  }
}

function getMonitoredActiveUsers() {
  const breakdown = {};

  CONFIG.monitoredCountries.forEach(country => {
    breakdown[country] = 0;
  });

  try {
    const request = {
      dimensions: [
        {
          name: 'country'
        }
      ],
      metrics: [
        {
          name: 'activeUsers'
        }
      ]
    };

    const response = AnalyticsData.Properties.runRealtimeReport(
      request,
      `properties/${CONFIG.ga4PropertyId}`
    );

    // No rows is a valid zero-traffic result, not an API failure.
    if (!response.rows) {
      return {
        available: true,
        total: 0,
        breakdown
      };
    }

    response.rows.forEach(row => {
      const country = row.dimensionValues[0].value;
      const users = Number(row.metricValues[0].value);

      if (Object.prototype.hasOwnProperty.call(breakdown, country)) {
        breakdown[country] = users;
      }
    });

    const total = Object.values(breakdown).reduce(
      (sum, users) => sum + users,
      0
    );

    return {
      available: true,
      total,
      breakdown
    };
  } catch (error) {
    console.error(`GA4 request failed: ${error.message}`);

    return {
      available: false,
      total: 0,
      breakdown
    };
  }
}

function sendTrafficAlert(users, breakdown) {
  const countryLines = CONFIG.monitoredCountries.map(country =>
    `- ${country}: ${breakdown[country] || 0} active users`
  );

  const subject =
    `[ALERT] Monitored GA4 traffic: ${users} active users`;

  const body = [
    'GA4 TRAFFIC ALERT',
    '',
    `Combined monitored traffic: ${users} active users`,
    ...countryLines,
    '',
    `Emergency threshold: ${CONFIG.combinedTrafficThreshold}`,
    `Recovery threshold: ${CONFIG.recoveryThreshold}`,
    `Time: ${new Date().toISOString()}`,
    '',
    'Automatic global AdSense emergency mode is disabled.',
    'Review the traffic evidence before using the manual emergency action.',
    '',
    'Check AdSense immediately:',
    '- Singapore impressions',
    '- CTR',
    '- RPM',
    '- Referrers',
    '- Device and browser patterns',
    '- GA4 engagement time',
    '',
    'Do not click any ads.'
  ].join('\n');

  MailApp.sendEmail({
    to: CONFIG.alertEmail,
    subject,
    body,
    name: 'Swaram Traffic Monitor'
  });

  console.log('Traffic alert email sent.');
}

function triggerGitHubWorkflow(mode) {
  if (mode !== 'normal' && mode !== 'emergency') {
    throw new Error('Mode must be either normal or emergency.');
  }

  const properties = PropertiesService.getScriptProperties();
  const githubToken = (properties.getProperty('GITHUB_TOKEN') || '').trim();

  if (!githubToken) {
    throw new Error(
      'Missing GITHUB_TOKEN in Apps Script project properties.'
    );
  }

  verifyGitHubWorkflowAccess(githubToken);

  const url =
    `https://api.github.com/repos/` +
    `${CONFIG.githubOwner}/` +
    `${CONFIG.githubRepository}` +
    `/actions/workflows/` +
    `${CONFIG.githubWorkflowId}/dispatches`;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Swaram-GA4-Traffic-Monitor',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({
      ref: CONFIG.githubBranch,
      inputs: {
        mode
      }
    }),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();

  if (statusCode !== 204) {
    throw new Error(
      `GitHub workflow dispatch failed with HTTP ${statusCode}: ` +
      response.getContentText()
    );
  }

  console.log(`GitHub workflow triggered with mode: ${mode}`);
}

function verifyGitHubWorkflowAccess(githubToken) {
  githubToken = (
    githubToken ||
    PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') ||
    ''
  ).trim();

  if (!githubToken) {
    throw new Error(
      'Missing GITHUB_TOKEN in Apps Script project properties.'
    );
  }

  const url =
    `https://api.github.com/repos/` +
    `${CONFIG.githubOwner}/` +
    `${CONFIG.githubRepository}` +
    `/actions/workflows/` +
    `${CONFIG.githubWorkflowId}`;

  console.log(`GitHub workflow access URL: ${url}`);
  console.log(`GitHub token length: ${githubToken.length}`);
  console.log(
    `GitHub token fingerprint: ${getTokenFingerprint(githubToken)}`
  );

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Swaram-GA4-Traffic-Monitor',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(
      `GitHub workflow access check failed with HTTP ${statusCode}: ` +
      response.getContentText() +
      ' Check that Apps Script has the current token and that it has ' +
      'Actions read/write access.'
    );
  }

  console.log('GitHub workflow access check passed.');
}

function getTokenFingerprint(token) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    token,
    Utilities.Charset.UTF_8
  );

  return digest
    .map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

function testGitHubWorkflowAccess() {
  const githubToken = (
    PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || ''
  ).trim();

  if (!githubToken) {
    throw new Error(
      'Missing GITHUB_TOKEN in Apps Script project properties.'
    );
  }

  verifyGitHubWorkflowAccess(githubToken);
}

function diagnoseGitHubTokenAccess() {
  const githubToken = (
    PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || ''
  ).trim();

  if (!githubToken) {
    throw new Error(
      'Missing GITHUB_TOKEN in Apps Script project properties.'
    );
  }

  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Swaram-GA4-Traffic-Monitor',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const endpoints = {
    identity: 'https://api.github.com/user',
    repository:
      `https://api.github.com/repos/${CONFIG.githubOwner}/` +
      `${CONFIG.githubRepository}`,
    workflow:
      `https://api.github.com/repos/${CONFIG.githubOwner}/` +
      `${CONFIG.githubRepository}/actions/workflows/${CONFIG.githubWorkflowId}`
  };

  Object.entries(endpoints).forEach(([name, url]) => {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers,
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    console.log(`GitHub ${name} check: HTTP ${statusCode}`);

    if (statusCode !== 200) {
      console.log(
        `GitHub ${name} response: ${response.getContentText()}`
      );
    }
  });
}

function triggerEmergencyModeManually() {
  triggerGitHubWorkflow('emergency');

  PropertiesService
    .getScriptProperties()
    .setProperty('LAST_TRIGGERED_MODE', 'emergency');
}

function restoreNormalModeManually() {
  triggerGitHubWorkflow('normal');

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('LAST_TRIGGERED_MODE', 'normal');
  properties.setProperty('SINGAPORE_HIGH_READINGS', '0');
  properties.setProperty('SINGAPORE_LOW_READINGS', '0');
}

function resetMonitorState() {
  const properties = PropertiesService.getScriptProperties();

  properties.deleteProperty('SINGAPORE_HIGH_READINGS');
  properties.deleteProperty('SINGAPORE_LOW_READINGS');
  properties.deleteProperty('LAST_ALERT_AT');
  properties.deleteProperty('LAST_TRIGGERED_MODE');

  console.log('Traffic monitor state reset.');
}

function setupTrafficMonitorTrigger() {
  const functionName = 'checkSingaporeTraffic';

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('Five-minute traffic monitor trigger created.');
}
