/*  ___  _               _            ___  _             
   |_ _|| |_  ___  ___ _| |_ ___  _ _|_ _|<_>._ _ _  ___ 
    | | | . |/ ._><_> | | | / ._>| '_>| | | || ' ' |/ ._>
    |_| |_|_|\___.<___| |_| \___.|_|  |_| |_||_|_|_|\___.
	(c) 2024 J.T.Sage - MIT License
*/
const ThrTime  = require('./lib/timers.js')
const dgram    = require('node:dgram')
const fastify  = require('fastify')({ logger : true, routerOptions : { ignoreTrailingSlash : true } })
const fs       = require('node:fs')
const osc      = require('simple-osc-lib')
const path     = require('node:path')
const TOML     = require('@iarna/toml')

const theseArgs = process.argv.slice(2)
let theTimer = null

if ( theseArgs.length !== 3 ) {
	process.stdout.write('Usage: npm start file.toml ISO-date ISO-24hr-time\n')
	process.exit(1)
} else {
	theTimer = new ThrTime.Timer(...theseArgs, false)
}

const oscSocket  = dgram.createSocket({type : 'udp4', reuseAddr : true})
const oscOutSock = dgram.createSocket({type : 'udp4', reuseAddr : true})
const oscLib     = new osc.simpleOscLib()

oscSocket.on('message', (msg, _rinfo) => { doOSC(msg) })
oscSocket.on('error',   (err) => {
	process.stdout.write(`osc listener error:\n${err.stack}\n`)
	oscSocket.close()
})
oscSocket.on('listening', () => {
	const address = oscSocket.address()
	process.stdout.write(`listening to osc on ${address.address}:${address.port}\n`)
})

oscSocket.bind(theTimer.OSCSettings.inPort, '0.0.0.0')

theTimer.on('switch-updated', sendSwitch)
theTimer.on('timer-updated', sendTimer)
theTimer.on('state-save', writeState)

fastify.register(require('@fastify/static'), {
	root : path.join(__dirname, 'public_html'),
})

fastify.setNotFoundHandler((_, reply) => {
	reply.code(200).type('text/html').sendFile('nope.html')
})

fastify.get('/api/read/remote', async (_, reply) => {
	reply.type('application/json').code(200)
	return jsonRespond({message : theTimer.serializeActive() })
})

fastify.get('/api/read/admin', async (_, reply) => {
	reply.type('application/json').code(200)
	return jsonRespond({message : theTimer.serialize })
})

fastify.get('/api*', async (_, reply) => {
	reply.type('application/json').code(403)
	return jsonRespond({}, 'invalid-request')
})

fastify.listen({ host : '::', port : theTimer.HTTPSettings.port }, (err) => {
	if (err) {
		fastify.log.error(err)
		process.exit(1)
	}
})

/* Startup Tasks */
sendSwitch()
sendTimer()
setInterval(sendSwitch, 30000)
setInterval(sendTimer, 30000)

if ( theTimer.OSCSettings.sendActiveTimer ) { setInterval(sendActive, 500) }
if ( theTimer.audioSettings.use) { setInterval(doAudio, 1000)}

/* Helper Functions */

function doOSC(packet) {
	try {
		const oscPacket = oscLib.readPacket(packet)
		const addressParts = oscPacket.address.replace('/', '').split('/')

		if ( addressParts[0] !== 'theaterTime' ) { return }

		process.stdout.write(`Acting on OSC : ${addressParts.join('/')}\n`)

		if ( addressParts[1] === 'switch' ) {
			const index = parseInt(addressParts[2]) - 1
			if      ( addressParts[3] === 'on' )     { theTimer.switchOn(index) }
			else if ( addressParts[3] === 'off' )    { theTimer.switchOff(index) }
			else if ( addressParts[3] === 'toggle' ) { theTimer.switchToggle(index) }
		} else if ( addressParts[1] === 'timer' ) {
			if      ( addressParts[2] === 'next' )     { theTimer.nextTimer() }
			else if ( addressParts[2] === 'previous' ) { theTimer.prevTimer() }
			else if ( addressParts[2] === 'stop' )     { theTimer.stopAll() }
		} else if ( addressParts[1] === 'reset' ) {
			theTimer.resetAll()
		} else if ( addressParts[1] === 'update' ) {
			if        ( addressParts[2] === 'date' ) {
				theTimer.changeStart(
					oscPacket.args[0]?.value ?? 0,
					oscPacket.args[1]?.value ?? 0,
					oscPacket.args[2]?.value ?? 0
				)
			} else if ( addressParts[2] === 'title' && oscPacket.args[0]?.value ) {
				theTimer.updateTitle(oscPacket.args[0]?.value)
			} else if ( addressParts[2] === 'subtitle' && oscPacket.args[0]?.value ) {
				theTimer.updateSubtitle(oscPacket.args[0]?.value)
			}
		}
	} catch (err) {
		process.stdout.write(`OSC packet problem : ${err}\n`)
	}
}

function doAudio() {
	const thisTimer = theTimer.serializeAudioTimer()

	if ( thisTimer !== null && thisTimer.type !== 'count-up' ) {
		theTimer.audioPlayTimer(thisTimer.wholeSeconds)
	}
}

function sendActive() {
	if ( theTimer.OSCSettings.sendActiveTimer ) {
		const thisTimer = theTimer.serializeOSCTimer()
		
		if ( thisTimer === null ) { return }

		if ( theTimer.OSCSettings.blinkExpired && ( thisTimer.type !== 'count-up' && thisTimer.wholeSeconds < 0 && thisTimer.wholeSeconds % 3 === 0 ) ) {
			sendOSCOut(oscLib
				.messageBuilder('/theaterTime/currentTimer')
				.integer(thisTimer.wholeSeconds)
				.string('')
				.string('')
				.string('')
				.toBuffer()
			)
		} else {
			sendOSCOut(oscLib
				.messageBuilder('/theaterTime/currentTimer')
				.integer(thisTimer.wholeSeconds)
				.string(thisTimer.title)
				.string(printTime(thisTimer.wholeSeconds))
				.string(thisTimer.type === 'count-up' ? '↑' : '↓')
				.toBuffer()
			)
		}
	}
}

function sendSwitch() {
	// Old way of sending.
	if ( theTimer.OSCSettings.sendSwitch ) {
		sendOSCOut(oscLib.buildBundle({
			timetag  : oscLib.getTimeTagBufferFromDelta(50/1000),
			elements : theTimer.serializeSwitches().map((element, index) => oscLib
				.messageBuilder(`/theaterTime/switch/${zPadN(index+1)}`)
				.string(element.title)
				.string(element.isOn ? element.onText : element.offText)
				.integer(Number(element.isOn))
				.toBuffer()
			),
		}))
	}

	// New way of sending
	// argument 1 : onText (if on) or empty
	// argument 2:  offText (if off) or empty
	if ( theTimer.OSCSettings.sendToggle ) {
		sendOSCOut(oscLib.buildBundle({
			timetag  : oscLib.getTimeTagBufferFromDelta(50/1000),
			elements : theTimer.serializeSwitches().map((e, index) => {
				const textStrings = [
					e.isOn ? e.onText : ' ',
					e.isOn ? ' ' : e.offText
				]

				if ( e.reverseColor ) { textStrings.reverse() }

				return oscLib
					.messageBuilder(`/theaterTime/toggle/${zPadN(index+1)}`)
					.string(textStrings[0])
					.string(textStrings[1])
					.toBuffer()
			}),
		}))
	}
}

function sendTimer() {
	if ( ! theTimer.OSCSettings.sendTimerStatus ) { return }

	sendOSCOut(oscLib.buildBundle({
		timetag  : oscLib.getTimeTagBufferFromDelta(50/1000),
		elements : theTimer.serializeTimers().map((element, index) => oscLib
			.messageBuilder(`/theaterTime/timer/${zPadN(index+1)}`)
			.string(element.title)
			.integer(Number(element.isOn))
			.toBuffer()
		),
	}))
}

function sendOSCOut(buffer) {
	oscOutSock.send(buffer, 0, buffer.length, theTimer.OSCSettings.outPort, theTimer.OSCSettings.address)
}

function printTime (secondsLeft) {
	const timerOverRun = secondsLeft < 0 ? '+ ' : ''
	const absSec       = Math.abs(secondsLeft)

	const hourLeft = Math.floor(absSec / 60 / 60)
	const minLeft  = Math.floor((absSec - hourLeft*60*60) / 60)
	const secLeft  = Math.floor(absSec - ((hourLeft*60*60) + (minLeft*60)))

	if ( hourLeft === 0 ) {
		return `${timerOverRun}${zPadN(minLeft)}:${zPadN(secLeft)}`
	}
	return `${timerOverRun}${hourLeft}:${zPadN(minLeft)}:${zPadN(secLeft)}`
}

function zPadN (num) { return num.toString().padStart(2, 0) }

function jsonRespond (obj, err = null) {
	const returnObj = obj ?? {}

	returnObj.status    = err === null ? 0 : 1
	returnObj.statusMsg = err === null ? 'ok' : err

	return returnObj
}

function writeState() {
	fs.writeFileSync(
		path.join(__dirname, 'current-state.toml'),
		TOML.stringify(theTimer.serializeSave, null, 2)
	)
}
