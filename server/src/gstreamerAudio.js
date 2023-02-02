
const child_process = require('child_process');
const { EventEmitter } = require('events');
const shell = require('shelljs');

const { getCodecInfoFromRtpParameters } = require('./utils');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

const GSTREAMER_DEBUG_LEVEL = process.env.GSTREAMER_DEBUG_LEVEL || 3;
const GSTREAMER_COMMAND = 'gst-launch-1.0';
const GSTREAMER_OPTIONS = '-v -e';

module.exports = class GStreamerAudio {
    constructor (ports, codec, dest) {
        this.ports = ports;
        this.codec = codec;
        this.dest = dest;
      this._process = undefined;
      this._observer = new EventEmitter();
      this._createProcess();
    }
  
    _createProcess () {
      // Use the commented out exe to create gstreamer dot file
      // const exe = `GST_DEBUG=${GSTREAMER_DEBUG_LEVEL} GST_DEBUG_DUMP_DOT_DIR=./dump ${GSTREAMER_COMMAND} ${GSTREAMER_OPTIONS}`;
      const exe = `GST_DEBUG=${GSTREAMER_DEBUG_LEVEL} ${GSTREAMER_COMMAND} ${GSTREAMER_OPTIONS}`;
      this._process = child_process.spawn(exe, this._commandArgs, {
        detached: false,
        shell: true
      });
  
      if (this._process.stderr) {
        this._process.stderr.setEncoding('utf-8');
      }
  
      if (this._process.stdout) {
        this._process.stdout.setEncoding('utf-8');
      }
  
      this._process.on('message', message =>
        console.log('gstreamer::process::message [pid:%d, message:%o]', this._process.pid, message)
      );
  
      this._process.on('error', error =>
        console.error('gstreamer::process::error [pid:%d, error:%o]', this._process.pid, error)
      );
  
      this._process.once('close', () => {
        console.log('gstreamer::process::close [pid:%d]', this._process.pid);
        this._observer.emit('process-close');
      });
  
      this._process.stderr.on('data', data =>
        console.log('gstreamer::process::stderr::data [data:%o]', data)
      );
  
      this._process.stdout.on('data', data =>
        console.log('gstreamer::process::stdout::data [data:%o]', data)
      );
    }
  
    kill() {
      console.log('kill() [pid:%d]', this._process.pid);
      this._process.kill('SIGINT');
    }

    get _commandArgs () {
        const clockRate = this.codec.clockRate;
        const pt = this.codec.preferredPayloadType;
        let commandArgs = [];
        console.log('this.ports', this.ports);
        for (let port of this.ports) {
          commandArgs = commandArgs.concat([
            `rtpbin name=rtpbin udpsrc port=${port} caps="application/x-rtp,media=audio,clock-rate=${clockRate},encoding-name=OPUS,payload=${pt}"`,
            '!',
            "rtpbin.recv_rtp_sink_0 rtpbin.",
            '!',
            "rtpopusdepay",
            '!',
            // debug: echo back
            // "opusdec",
            // "autoaudiosink"
            "opusparse",
            '!',
            "oggmux",
            '!',
            `filesink location=${this.dest}`
          ])
        }
        return commandArgs;
      }
}
  