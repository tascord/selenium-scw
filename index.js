const { Builder } = require('selenium-webdriver');
const { existsSync, mkdirSync } = require('fs');
const { execSync } = require('child_process');
const Chrome = require('selenium-webdriver/chrome');
const si = require('systeminformation');
const path = require('path');
const io = require("socket.io-client")
const $ = require('phin');

const socket = io("wss://flogs.imflo.pet");

const MONITORS = [];
const TEMP_DIR = path.join(require('os').tmpdir(), 'rm_winmove');
const RESTART = [1, 1];
const RESTART_TARGET = 2;
const TRYING = false;

const prelude = async () => {

  MONITORS.push(...JSON.parse(await (execSync(path.join(__dirname, 'scw.exe'))).toString()));
  console.log(`Found ${MONITORS.length} monitor(s)`)

  const group = process.argv[2];
  const monitors = (await $({ url: `https://raw.githubusercontent.com/RMHEDGE/rm-displays/main/group_${group}.json`, parse: 'json' })).body;

  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR);
  monitors.forEach(make);

  setInterval(restart, 1 * 1000);
};
    
const spawn_split = (dimensions, displays, index, id) => {
  let rows = displays.map(d => d.span.row[1]).sort().reverse()[0];
  let cols = displays.map(d => d.span.col[1]).sort().reverse()[0];

  let width = dimensions.width / rows;
  let height = dimensions.height / cols;

  displays.forEach((d, i) => {
    let x = Math.trunc(width * (d.span.row[0] - 1));
    let y = Math.trunc(height * (d.span.col[0] - 1));
    let w = Math.trunc(width * (d.span.row[1] - (d.span.row[0] - 1)));
    let h = Math.trunc(height * (d.span.col[1] - (d.span.col[0] - 1)));
    make({ id, displays: d.url, pos: [x, y, w, h] }, index + '-' + i);
  });
}

const make = async (display, index) => {
  let monitor = MONITORS[display.id];
  if (monitor === undefined) {
    console.log("Monitor not found: ", display.id);
    return;
  }

  if (Array.isArray(display.displays)) {
    spawn_split(monitor, display.displays, index, display.id);
    return;
  }

  // return;

  const dir = path.join(TEMP_DIR, index.toString());
  const url = display.displays;

  const opts = new Chrome.Options();
  opts.addArguments('--app=data;')
  opts.addArguments('--window-name=' + index)
  opts.addArguments('--user-data-dir=' + dir)
  opts.excludeSwitches('enable-automation')

  if (display.pos) {
    console.log(`Spawning ${url} at ${display.pos}`)
    opts.addArguments(`--window-position=${display.pos[0]},${display.pos[1]}`);
    opts.addArguments(`--window-size=${display.pos[2]},${display.pos[3]}`);
  } else {
    console.log(`Spawning ${url} at ${monitor.left},${monitor.top}`);
    opts.addArguments(`--window-position=${monitor.left},${monitor.top}`);
    opts.addArguments('--kiosk')
  }

  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(opts)
    .build();

  try {
    await driver.get(url);
    setInterval(async () => await driver.get(url), 10 * 60 * 1000);
  } catch (e) {
    console.log("ERR: ", e);
    driver.close();
  }

};

const restart = async () => {
  RESTART[0] = (await si.graphics()).displays.length;

  // Restart if all displays are connected, and it's 9:00am
  if ((new Date().getHours() == 9 && new Date().getMinutes() == 0) && require('os').uptime() > 1 * 60 * 60 && !TRYING) {
    TRYING = true;
    const t = setInterval(() => {
      if (RESTART[0] == RESTART_TARGET) {
        TRYING == false;
        execSync(`shutdown /r /t 0 /f`);
        clearInterval(t);
      }
    }, 1 * 60 * 1000);
  }

  if (RESTART[0] !== RESTART[1]) {
    RESTART[1] = RESTART[0];
    // Restart if displays have been disconnected, but are now reconnected
    if (restart[0] == RESTART_TARGET) {
      console.log("Restarting");
      execSync(`shutdown /r /t 0 /f`);
      monitors.forEach(make);
    }
  }
}

socket.on('connection', s => {
  s.emit('register', {
    name: require('os').hostname,
    intention: 'screen-wall'
  });
  s.on('ask', (data) => {
    switch (data.job) {
      case "restart": {
        execSync(`shutdown /r /t 0 /f`);
        break;
      }
      case "update": {
        execSync(`git pull`);
        execSync(`shutdown /r /t 0 /f`)
        break;
      }
    }
  })
})

prelude();