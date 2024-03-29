const { Builder } = require('selenium-webdriver');
const { existsSync, mkdirSync } = require('fs');
const { execSync } = require('child_process');
const Chrome = require('selenium-webdriver/chrome');
const si = require('systeminformation');
const path = require('path');
const io = require("socket.io-client")
const $ = require('phin');

const socket = io("wss://flogs.imflo.pet");

let MONITORS = [];
const TEMP_DIR = path.join(require('os').tmpdir(), 'rm_winmove');
const RESTART = [1, 1];
const RESTART_TARGET = 2;
const TRYING = false;

const console = {
  log: (msg) => {
    socket.emit('info', msg);
    process.stdout.write(msg + '\n');
  },
  warn: (msg) => {
    socket.emit('warn', msg);
    process.stdout.write(msg + '\n');
  },
  error: (msg) => {
    socket.emit('error', msg);
    process.stdout.write(msg + '\n');
  }
}

const are_we_ready_yet = () => new Promise(async (r) => {

  const group = process.argv[2];
  const monitors = (await $({ url: `https://raw.githubusercontent.com/RMHEDGE/rm-displays/main/group_${group}.json`, parse: 'json' })).body;
  const total = monitors.length;
  console.log(`Waiting for ${total} monitors.`);

  do {
    MONITORS = JSON.parse(await (execSync(path.join(__dirname, 'scw.exe'))).toString())
    await (new Promise((r) => setTimeout(r, 1000)));
  } while (
    MONITORS.length < total
  )

  console.log(`Found required monitor count. Starting!`);
  r(monitors);
})

const prelude = async () => {
  const monitors = await are_we_ready_yet();
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR);
  monitors.forEach(make);
  setInterval(restart, 1 * 1000);
};

const spawn_split = (dimensions, displays, index, id) => {
  let rows = displays.map(d => d.span.row[1]).sort().reverse()[0];
  let cols = displays.map(d => d.span.col[1]).sort().reverse()[0];

  let width = dimensions.width / cols; // Fix: Use cols instead of rows
  let height = dimensions.height / rows; // Fix: Use rows instead of cols

  displays.forEach((d, i) => {
    let x = Math.trunc(width * (d.span.col[0] - 1)); // Fix: Use col instead of row
    let y = Math.trunc(height * (d.span.row[0] - 1)); // Fix: Use row instead of col
    let w = Math.trunc(width * (d.span.col[1] - (d.span.col[0] - 1))); // Fix: Use col instead of row
    let h = Math.trunc(height * (d.span.row[1] - (d.span.row[0] - 1))); // Fix: Use row instead of col
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

  const dir = path.join(TEMP_DIR, index.toString());
  const url = display.displays.replaceAll('SCW_DATE', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toLocaleDateString().split('/').reverse().join('-'));

  const opts = new Chrome.Options();
  opts.addArguments('--app=https://google.com')
  // opts.addArguments('--window-name=' + index)
  opts.addArguments('--user-data-dir=' + dir)
  opts.excludeSwitches('enable-automation')

  if (display.pos) {
    let x = display.pos[0] + monitor.left;
    let y = display.pos[1] + monitor.top;
    let w = display.pos[2];
    let h = display.pos[3];
    opts.addArguments('--new-window');

    console.log(`Spawning ${url} at ${x},${y} ${w}x${h}`)
    opts.addArguments(`--window-position=${x},${y}`);
    opts.addArguments(`--window-size=${w},${h}`);
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
    setInterval(async () => {
      await driver.get(url);
    }, 10 * 60 * 1000);
  } catch (e) {
    console.log("ERR: \n" + String(e));
    driver.close();
  }

};

const restart = async () => {
  // Restart if all displays are connected, and it's 9:00am
  if ((new Date().getHours() == 9 && new Date().getMinutes() == 0) && require('os').uptime() > 1 * 60 && !TRYING) {
    console.log(`Time: 9.00, awaiting shutdown when monitors are connected`)
    TRYING = true;
    const t = setInterval(() => {
      if (RESTART[0] == RESTART_TARGET) {
        TRYING == false;
        execSync(`shutdown /r /t 0 /f`);
        clearInterval(t);
      }
    }, 1 * 60 * 1000);
  }

  if (require('os').uptime() > 24 * 60 * 60) {
    console.log("Uptime Expired. Performing update.")
  }
}

socket.on('connect', () => {
  socket.emit('details', {
    name: require('os').hostname(),
    intention: 'screen-wall for group' + process.argv[2]
  });
  socket.on('do', (data) => {
    switch (data.job) {
      case "restart": {
        console.log(`Asked to 'restart'`)
        execSync(`shutdown /r /t 0 /f`);
        break;
      }
      case "update": {
        console.log(`Asked to 'update'`)
        execSync(`git pull`);
        execSync(`shutdown /r /t 0 /f`)
        break;
      }
      default: {
        console.log(`Unknown job: ${data.job}`)
      }
    }
  })
})

prelude();