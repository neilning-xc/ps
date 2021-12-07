const ChildProcess = require('child_process');
const TableParser = require('table-parser');
const os = require('os');

const IS_WIN = process.platform === 'win32';

/**
 * End of line.
 * Basically, the EOL should be:
 * - windows: \r\n
 * - *nix: \n
 * But i'm trying to get every possibilities covered.
 */
const EOL = /(\r\n)|(\n\r)|\n|\r/;
const SystemEOL = os.EOL;

/**
 * Execute child process
 * @type {Function}
 * @param {String[]} args
 * @param {Function} callback
 * @param {Object=null} callback.err
 * @param {Object[]} callback.stdout
 */
const Exec = (args: string | string[], callback: any) => {
  const { spawn } = ChildProcess;

  // on windows, if use ChildProcess.exec(`wmic process get`), the stdout will gives you nothing
  // that's why I use `cmd` instead
  if (IS_WIN) {
    const CMD = spawn('cmd');
    let stdout: string | string[] = '';
    let stderr: string | null = null;

    CMD.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    CMD.stderr.on('data', (data) => {
      if (stderr === null) {
        stderr = data.toString();
      } else {
        stderr += data.toString();
      }
    });

    CMD.on('exit', () => {
      let beginRow: number;
      stdout = (stdout as string).split(EOL);

      // Find the line index for the titles
      stdout.forEach((out, index) => {
        // eslint-disable-next-line valid-typeof
        if (out && typeof beginRow === undefined && out.indexOf('CommandLine') === 0) {
          beginRow = index;
        }
      });

      // get rid of the start (copyright) and the end (current pwd)
      stdout.splice(stdout.length - 1, 1);
      stdout.splice(0, beginRow);

      callback(stderr, stdout.join(SystemEOL) || false);
    });

    CMD.stdin.write('wmic process get ProcessId,ParentProcessId,CommandLine \n');
    CMD.stdin.end();
  } else {
    if (typeof args === 'string') {
      args = args.split(/\s+/);
    }
    const child = spawn('ps', args);
    let stdout = '';
    let stderr: string | null = null;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      if (stderr === null) {
        stderr = data.toString();
      } else {
        stderr += data.toString();
      }
    });

    child.on('exit', () => {
      if (stderr) {
        return callback(stderr.toString());
      }
      callback(null, stdout || false);
    });
  }
};

/**
 * Query Process: Focus on pid & cmd
 * @param query
 * @param {String|String[]} query.pid
 * @param {String} query.command RegExp String
 * @param {String} query.arguments RegExp String
 * @param {String|array} query.psargs
 * @param {String|array} query.keywords
 * @param {Function} callback
 * @param {Object=null} callback.err
 * @param {Object[]} callback.processList
 * @return {Object}
 */

exports.lookup = function (query, callback) {

  /**
   * add 'lx' as default ps arguments, since the default ps output in linux like "ubuntu", wont include command arguments
   */
  var exeArgs = query.psargs || ['lx'];
  var filter = {};
  var idList;
  var keywords = query.keywords || [];

  // Lookup by PID
  if (query.pid) {

    if (Array.isArray(query.pid)) {
      idList = query.pid;
    }
    else {
      idList = [query.pid];
    }

    // Cast all PIDs as Strings
    idList = idList.map(function (v) {
      return String(v);
    });

  }


  if (query.command) {
    filter['command'] = new RegExp(query.command, 'i');
  }

  if (query.arguments) {
    filter['arguments'] = new RegExp(query.arguments, 'i');
  }

  if (query.ppid) {
    filter['ppid'] = new RegExp(query.ppid);
  }

  return Exec(exeArgs, function (err, output) {
    if (err) {
      return callback(err);
    }
    else {
      var processList = parseGrid(output, keywords);
      var resultList = [];

      processList.forEach(function (p) {

        var flt;
        var type;
        var result = true;

        if (idList && idList.indexOf(String(p.pid)) < 0) {
          return;
        }

        for (type in filter) {
          flt = filter[type];
          result = flt.test(p[type]) ? result : false;
        }

        if (result) {
          resultList.push(p);
        }
      });

      callback(null, resultList);
    }
  });
};

/**
 * Kill process
 * @param pid
 * @param {Object|String} signal
 * @param {String} signal.signal
 * @param {number} signal.timeout
 * @param next
 */

exports.kill = function( pid, signal, next ){
  //opts are optional
  if(arguments.length == 2 && typeof signal == 'function'){
    next = signal;
    signal = undefined;
  }

  var checkTimeoutSeconds = (signal && signal.timeout) || 30;

  if (typeof signal === 'object') {
    signal = signal.signal;
  }

  try {
    process.kill(pid, signal);
  } catch(e) {
    return next && next(e);
  }

  var checkConfident = 0;
  var checkTimeoutTimer = null;
  var checkIsTimeout = false;

  function checkKilled(finishCallback) {
    exports.lookup({ pid: pid }, function(err, list) {
      if (checkIsTimeout) return;

      if (err) {
        clearTimeout(checkTimeoutTimer);
        finishCallback && finishCallback(err);
      } else if(list.length > 0) {
        checkConfident = (checkConfident - 1) || 0;
        checkKilled(finishCallback);
      } else {
        checkConfident++;
        if (checkConfident === 5) {
          clearTimeout(checkTimeoutTimer);
          finishCallback && finishCallback();
        } else {
          checkKilled(finishCallback);
        }
      }
    });
  }

  next && checkKilled(next);

  checkTimeoutTimer = next && setTimeout(function() {
    checkIsTimeout = true;
    next(new Error('Kill process timeout'));
  }, checkTimeoutSeconds * 1000);
};

/**
 * Parse the stdout into readable object.
 * @param {String} output
 * @param {Array} keywords
 */

function parseGrid(output, keywords) {
  if (!output) {
    return [];
  }
  return formatOutput(TableParser.parse(output), keywords);
}

/**
 * format the structure, extract pid, command, arguments, ppid
 * @param data
 * @param {Array} keywords Add extra keyword
 * @return {Array}
 */

function formatOutput(data, keywords) {
  var formatedData = [];
  data.forEach(function (d) {
    var pid = ( d.PID && d.PID[0] ) || ( d.ProcessId && d.ProcessId[0] ) || undefined;
    var cmd = d.CMD || d.CommandLine || d.COMMAND || undefined;
    var ppid = ( d.PPID && d.PPID[0] ) || ( d.ParentProcessId && d.ParentProcessId[0] ) || undefined;

    if (pid && cmd) {
      var command = cmd[0];
      var args = '';

      if (cmd.length > 1) {
        args = cmd.slice(1);
      }

      var extraCols = {};
      keywords.forEach(function(keyword) {
        var rawKey = keyword;
        if (!IS_WIN) {
          rawKey = keyword.toUpperCase();
        }

        extraCols[keyword] = (d[rawKey] && d[rawKey][0]) || undefined;
      });

      var cols = {
        pid: pid,
        command: command,
        arguments: args,
        ppid: ppid
      };

      formatedData.push(Object.assign(cols, extraCols));
    }
  });

  return formatedData;
}
