const fs = require('fs');
const config = require('./config');
const {
    getPort,
    releasePort
} = require('./port');
const mediasoup = require('./mediasoup');
const Peer = require('./peer');
const GStreamerAudio = require('./gstreamerAudio');
const { PipeTransport } = require('mediasoup/node/lib/PipeTransport');

const PROCESS_NAME = process.env.PROCESS_NAME || 'FFmpeg';
const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH;

class RecordService {
    scenarios = {} // roomId, scene: string, int
    peers = {} // { roomId: { peerId: peer } }: string, string, peer object
    router = null; // Router of mediasoup
    pipeTransport = {}; // id_pipeTransport: pipeTransport of mediasoup
    scenes = {}; // meetingId, scene: string, int

    /**
     * initialize record service
     */
    async initialize() {
        await mediasoup.initializeWorkers();
        this.router = await mediasoup.createRouter();
    }

    /**
     * create pipeTransport and connect
     * @param {string} id 
     * @param {string} localIp is otherPipeTransport.tuple.localIp 
     * @param {string} localPort is otherPipeTransport.tuple.localPort
     */
    async createPipeTransportAndConnect(peerId, localIp, localPort) {
        console.log(`createPipeTransportAndConnect peerID ${peerId} - localIp ${localIp} - localPort ${localPort}`)
        let transport;
        try {
            transport = await this.router.createPipeTransport({
                listenIp: `127.0.0.1`
            });
            this.pipeTransport[peerId] = transport;
            transport.observer.on('close', () => {
                this._announceOtherPipeTransport(peerId);
            });
            await transport.connect({
                ip: localIp,
                port: localPort
            });
            console.log(`createPipeTransportAndConnect result ip ${transport.tuple.localIp}, port: ${transport.tuple.localPort}`)
            return { ip: transport.tuple.localIp, port: transport.tuple.localPort };
        } catch (err) {
            console.error('pipeTransport ERROR:', err);
            if (transport) {
                transport.close();
                transport = null;
                delete this.pipeTransport[id];
            }
        }
    }

    /**
     * announce to other pipetransport that this transport will close
     * @param {string} id is a identify of transport 
     */
    _announceOtherPipeTransport(id) {
        console.log(`announceOtherPipeTransport `, `pipeTransport ${id} close`);
        /// TODO
    }

    /**
     * pipe producer to consumer
     * @param {string} id 
     * @param {string} producerId 
     * @param {string} kind is video / audio 
     * @param {import('mediasoup/node/lib/RtpParameters').RtpParameters} rtpParameters 
     * @param {json} appData 
     * @param {boolean} producerPaused 
     */
    async pipeProducerToConsumer(peerId, producerId, kind, rtpParameters, appData, producerPaused) {
        let pipeProducer;
        const pipeTransport = this.pipeTransport[peerId]
        this.peers[peerId] = new Peer(peerId);
        pipeProducer = await pipeTransport.produce(
            {
                id: producerId,
                kind: kind,
                rtpParameters: rtpParameters,
                appData: appData,
                paused: producerPaused
            });
        pipeProducer.observer.on('close', () => {
            this._announcePipeProducerClose(pipeProducer.id);
        });
    }

    /**
     * announce other pipeTransport that mine producer close
     * @param {string} id 
     */
    _announcePipeProducerClose(id) {

    }

    async _publishProducerRtpStream(peerId, kind, producerId) {
        const peer = this.peers[peerId];

        console.log('publishProducerRtpStream()');

        // Create the mediasoup RTP Transport used to send media to the GStreamer process
        const rtpTransportConfig = config.plainRtpTransport;

        // If the process is set to GStreamer set rtcpMux to false
        if (PROCESS_NAME === 'GStreamer') {
            rtpTransportConfig.rtcpMux = false;
        }

        const rtpTransport = await mediasoup.createTransport('plain', this.router, rtpTransportConfig);

        // Set the receiver RTP ports
        const remoteRtpPort = await getPort();
        peer.remotePorts.push(remoteRtpPort);

        let remoteRtcpPort;
        // If rtpTransport rtcpMux is false also set the receiver RTCP ports
        if (!rtpTransportConfig.rtcpMux) {
            remoteRtcpPort = await getPort();
            peer.remotePorts.push(remoteRtcpPort);
        }


        // Connect the mediasoup RTP transport to the ports used by GStreamer
        await rtpTransport.connect({
            ip: '127.0.0.1',
            port: remoteRtpPort,
            rtcpPort: remoteRtcpPort
        });

        peer.addTransport(rtpTransport);

        const codecs = [];
        // Codec passed to the RTP Consumer must match the codec in the Mediasoup router rtpCapabilities
        const routerCodec = this.router.rtpCapabilities.codecs.find(
            codec => codec.kind === kind
        );
        codecs.push(routerCodec);

        const rtpCapabilities = {
            codecs,
            rtcpFeedback: []
        };

        // Start the consumer paused
        // Once the gstreamer process is ready to consume resume and send a keyframe
        const rtpConsumer = await rtpTransport.consume({
            producerId: producerId,
            rtpCapabilities,
            paused: true
        });

        peer.consumers.push(rtpConsumer);

        return {
            remoteRtpPort,
            remoteRtcpPort,
            localRtcpPort: rtpTransport.rtcpTuple ? rtpTransport.rtcpTuple.localPort : undefined,
            rtpCapabilities,
            rtpParameters: rtpConsumer.rtpParameters,
            port: rtpTransport.tuple.remotePort,
        };
    }

    async record(roomId, peerId, kind, producerId) {
        const peer = this.peers[peerId];
        peer.setRoomId(roomId);
        if (peer.process) {
            return;
        }
        if (!this.scenes[roomId]) {
            this.scenes[roomId] = 1;
        }
        const scene = this.scenes[roomId];
        if (!this.scenarios[roomId]) {
            this.scenarios[roomId] = {};
        }
        if (!this.scenarios[roomId][scene]) {
            this.scenarios[roomId][scene] = new Scene();
        }
        let recordInfo = {};
        recordInfo[kind] = await this._publishProducerRtpStream(peerId, kind, producerId);
        const voice = new Voice();
        const startTime = Date.now();
        voice.id = peer.sessionId + '_' + startTime.toString();
        voice.start = startTime.toString();
        recordInfo.fileName = peer.sessionId + '_' + startTime.toString();
        const sceneObj = this.scenarios[roomId][scene];
        if (!sceneObj.start) {
            sceneObj.start = startTime.toString();
        }
        voice.audio = `${recordInfo.fileName}.ogg`;
        sceneObj.voices[voice.id] = voice;
        peer.process = this._getProcess(roomId, recordInfo.fileName, recordInfo[kind].port);
        let timeoutProcess;
        timeoutProcess = setTimeout(async () => {
            for (const consumer of peer.consumers) {
                await consumer.resume();
                await consumer.requestKeyFrame();
                clearTimeout(timeoutProcess);
            }
        }, 1000);
    }

    _getProcess = (roomId, fileName, port) => {
        const dir = `${RECORD_FILE_LOCATION_PATH}/${roomId}`;
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        switch (PROCESS_NAME) {
            case 'GStreamer':
                return new GStreamerAudio(port, this.router.rtpCapabilities.codecs[0], `${RECORD_FILE_LOCATION_PATH}/${roomId}/${fileName}.ogg`);
        }
    };

    stopRecord(roomId) {
        const timeEnd = Date.now();
        let scene = this.scenes[roomId];
        for (let peer of Object.values(this.peers)) {
            if (peer.roomId == roomId) {
                peer.process.kill();
                peer.process = undefined;
                // Release ports from port set
                for (const remotePort of peer.remotePorts) {
                    releasePort(remotePort);
                }
                console.log('scenarios[scene].voices', this.scenarios[roomId][scene].voices);
                for (let voice of Object.values(this.scenarios[roomId][scene].voices)) {
                    console.log('keyVoice ', voice.id);
                    if (!voice.end) {
                        voice.end = timeEnd.toString();
                    }
                    break;
                }
            }
        }
        this.scenarios[roomId][scene].end = timeEnd.toString();
        console.log('scenarios ', JSON.stringify(this.scenarios[roomId]));
        const data = JSON.stringify(this.scenarios[roomId]);
        fs.writeFileSync(`${RECORD_FILE_LOCATION_PATH}/${roomId}/${roomId}.json`, data);
        this.scenes[roomId] = ++scene;
    }
}

const recordService = new RecordService();
module.exports = recordService;
// export default recordService;

class Scene {
    constructor() {
        this.id;
        this.start;
        this.end;
        this.sharescreens = {};
        this.voices = {};
    }
}

class ShareScreen {
    constructor() {
        this.id;
        this.start;
        this.end;
        this.video;
        this.audio;
    }
}

class Voice {
    constructor() {
        this.id;
        this.start;
        this.end;
        this.audio;
    }
}
