const http = require('http');
const express = require('express');
const request = require('request');
const fs = require('fs');
const unzip = require('unzip');

if (process.env.PICLUSTER_CONFIG) {
  var config = JSON.parse(fs.readFileSync(process.env.PICLUSTER_CONFIG, 'utf8'));
} else {
  var config = JSON.parse(fs.readFileSync('../config.json', 'utf8'));
}
const port = config.agent_port;
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser());
const server = require('http').createServer(app);
const os = require('os');

const node = os.hostname();
const async = require('async');
const Promisify = require('util').promisify;
const exec = require('child-process-promise').exec;

const noop = function () {};
var vip = '';
let vip_slave = '';
const vip_device = '';
let ip_add_command = '';
let ip_delete_command = '';
let vip_ping_time = '';
const token = config.token;
const multer = require('multer');

const upload = multer({
  dest: '../'
});

if (config.autostart_containers) {
  console.log('Starting all the containers.....');
  const options = {
    host: config.web_connect,
    path: '/start?token=' + token + '&container=*',
    port: config.server_port
  };
  const autostart_request = http.get(options, response => {}).on('error', e => {
    console.error(e);
  });
}

if (config.vip_ip && config.vip) {
  var vip = config.vip_ip;
  Object.keys(config.vip).forEach(i => {
    const _node = config.vip[i].node;
    Object.keys(config.vip[i]).forEach(key => {
      if (!config.vip[i].hasOwnProperty(key)) {
        return;
      }
      const interfaces = require('os').networkInterfaces();
      Object.keys(interfaces).forEach(devName => {
        const iface = interfaces[devName];
        iface.forEach(alias => {
          if (alias.address !== _node) {
            return;
          }
          vip_slave = config.vip[i].slave;
          vip_eth_device = config.vip[i].vip_eth_device;
          ip_add_command = 'ip addr add ' + config.vip_ip + ' dev ' + vip_eth_device;
          const cmd = ip_delete_command = 'ip addr del ' + config.vip_ip + '/32 dev ' + vip_eth_device;
          vip_ping_time = config.vip[i].vip_ping_time;
          exec(cmd).then(send_ping).catch(send_ping);
        });
      });
    });
  });
}

function send_ping() {
  setTimeout(() => {
    const responseString = '';
    const token_body = JSON.stringify({
      token
    });
    const options = {
      url: 'http://' + vip_slave + ':' + port + '/pong',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': token_body.length
      },
      body: token_body
    };

    request(options, (error, response, body) => {
      let found_vip = false;

      if ((error || response.statusCode != '200')) {
        var cmd = ip_add_command;
        // Console.log("\nUnable to connect to: " + vip_slave + ". Bringing up VIP on this host.");
        exec(cmd).then(noop).catch(noop);
      } else {
        const interfaces = require('os').networkInterfaces();
        Object.keys(interfaces).forEach(devName => {
          const iface = interfaces[devName];
          iface.forEach(alias => {
            if (alias.address == vip) {
              found_vip = true;
            }
          });
        });
        const json_object = JSON.parse(body);

        if (json_object.vip_detected == 'false' && found_vip == false) {
          console.log('\nVIP not detected on either machine. Bringing up the VIP on this host.');
          var cmd = ip_add_command;
          exec(cmd).catch(error => {
            console.log(error);
          });
        }
        if ((json_object.vip_detected == 'true' && found_vip == true)) {
          console.log('\nVIP detected on boths hosts! Stopping the VIP on this host.');
          var cmd = ip_delete_command;
          exec(cmd).catch(error => {
            console.log(error);
          });
        }
      }
    });
    send_ping();
  }, vip_ping_time);
}

app.get('/rsyslog', (req, res) => {
  const check_token = req.query.token;
  if ((check_token != token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    res.sendFile(config.rsyslog_logfile);
  }
});

app.post('/killvip', (req, res) => {
  const check_token = req.body.token;
  if (check_token !== token) {
    return res.status(401).end('\nError: Invalid Credentials');
  }

  if (config.vip_ip) {
    const cmd = ip_delete_command;
    exec(cmd).then((stdout, stderr) => {
      res.end('\nCompleted.');
    }).catch(error => {
      console.log(error);
    });
  }
});

app.post('/pong', (req, res) => {
  const check_token = req.body.token;
  if (check_token !== token) {
    return res.status(500).send('Something broke!');
  }

  const responseString = '';
  let vip_status = 'false';
  const interfaces = require('os').networkInterfaces();

  Object.keys(interfaces).forEach(devName => {
    const iface = interfaces[devName];
    iface.forEach(alias => {
      if (alias.address == vip) {
        vip_status = 'true';
      }
    });
  });

  const body = {
    vip_detected: vip_status
  };
  res.send(body);
});

function unzipFile(file) {
  fs.createReadStream(file).pipe(unzip.Extract({
    path: config.docker
  }));
}
app.post('/receive-file', upload.single('file'), (req, res, next) => {
  const check_token = req.body.token;
  if ((check_token != token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    fs.readFile(req.file.path, (err, data) => {
      const newPath = '../' + req.file.originalname;
      fs.writeFile(newPath, data, err => {
        unzipFile(newPath);
      });
    });
    res.end('Done');
  }
});

app.post('/run', (req, res) => {
  const output = {
    output: [],
    node
  };

  const check_token = req.body.token;

  if (check_token !== token) {
    return res.status(401).json({
      output: 'Not Authorized to connect to this agent!'
    });
  }

  // Backwards compatability...
  if (!('commands' in req.body) && 'command' in req.body) {
    req.body.commands = req.body.command;
  }

  const commands = (typeof req.body.commands === 'string') ? [req.body.commands] : req.body.commands;

  if (!(Array.isArray(commands))) {
    return res.status(400).json({
      output: 'Bad Request'
    });
  }

  async.eachSeries(commands, (command, cb) => {
    if (typeof command === 'string') {
      command = [command];
    }
    if (!(Array.isArray(command))) {
      return;
    }
    // Console.log('command', command);
    exec(command.join(' '), {
      cwd: __dirname
    }).then(log => {
      // Console.log('output', log);
      output.output.push(`${log.stdout || ''}${log.stderr || ''}`);
      return cb();
    }).catch(e => {
      // Console.log('error', e);
      output.output.push(`${e.stdout || ''}${e.stderr || ''}`);
      return cb(e);
    });
  }, e => {
    if (e) {
      console.error('error:', e);
    }
    // Console.log('output', output);
    res.json(output);
  });
});

server.listen(port, () => {
  console.log('Listening on port %d', port);
});
