/*  ___  _               _            ___  _             
   |_ _|| |_  ___  ___ _| |_ ___  _ _|_ _|<_>._ _ _  ___ 
    | | | . |/ ._><_> | | | / ._>| '_>| | | || ' ' |/ ._>
    |_| |_|_|\___.<___| |_| \___.|_|  |_| |_||_|_|_|\___.
	(c) 2024 J.T.Sage - MIT License
*/
const ThrTime  = require('./lib/timers.js')
const dgram    = require('node:dgram')
const fastify  = require('fastify')({ ignoreTrailingSlash : true, logger : true })
const fs       = require('node:fs')
const osc      = require('simple-osc-lib')
const path     = require('node:path')

const theseArgs = process.argv.slice(2)
let theTimer = null

if ( theseArgs.length === 0 ) {
	if ( fs.existsSync(path.join(__dirname, 'current-state.json')) ) {
		theTimer = new ThrTime.Timer('current-state.json')
	} else {
		throw new SyntaxError('Saved State Not Found -- Usage: npm start file.toml ISO-date ISO-24hr-time')
	}
} else if ( theseArgs.length !== 3 ) {
	throw new SyntaxError('Usage: npm start file.toml ISO-date ISO-24hr-time')
} else {
	theTimer = new ThrTime.Timer(...theseArgs)
}

const oscOption  = theTimer.getOSC()
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

oscSocket.bind(oscOption.inPort, '0.0.0.0')

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
	return jsonRespond({message : theTimer.getActiveOnly() })
})

fastify.get('/api/read/admin', async (_, reply) => {
	reply.type('application/json').code(200)
	return jsonRespond({message : theTimer.serialize() })
})

fastify.get('/api*', async (_, reply) => {
	reply.type('application/json').code(403)
	return jsonRespond({}, 'invalid-request')
})

fastify.listen({ port : theTimer.getHTTP().port }, (err) => {
	if (err) {
		fastify.log.error(err)
		process.exit(1)
	}
})

sendSwitch()
sendTimer()

if ( oscOption.sendActiveTimer ) {
	setInterval(sendActive, 500)
}

function doOSC(packet) {
	try {
		const thisMessage = oscLib.readPacket(packet)

		const addressParts = thisMessage.address.replace('/', '').split('/')

		if ( addressParts[0] !== 'theaterTime' ) { return }

		process.stdout.write(`Acting on OSC : ${thisMessage.address}\n`)

		if ( addressParts[1] === 'switch' ) {
			const index = parseInt(addressParts[2]) - 1
			if      ( addressParts[3] === 'on' )     { theTimer.switchOn(index) }
			else if ( addressParts[3] === 'off' )    { theTimer.switchOff(index) }
			else if ( addressParts[3] === 'toggle' ) { theTimer.switchToggle(index) }
		} else if ( addressParts[1] === 'timer' ) {
			if      ( addressParts[2] === 'next' )     { theTimer.nextTimer() }
			else if ( addressParts[2] === 'previous' ) { theTimer.prevTimer() }
			else if ( addressParts[2] === 'stop' )     { theTimer.stopAll() }
		}
	} catch (err) {
		process.stdout.write(`OSC packet problem : ${err}\n`)
	}
}

function sendActive() {
	if ( oscOption.sendActiveTimer ) {
		const thisTimer = theTimer.getRunningTimer()
		if ( thisTimer === null ) { return }

		let wholeSeconds = 0

		if ( thisTimer.type === 'count-up') {
			const theDate = new Date(thisTimer.dateStart)
			wholeSeconds = Math.floor((new Date() - theDate) / 1000)
		} else {
			const theDate      = new Date(thisTimer.dateTarget)
			wholeSeconds = Math.floor((theDate - new Date()) / 1000)
		}
		const buffer = oscLib
			.messageBuilder('/theaterTime/currentTimer')
			.integer(wholeSeconds)
			.string(thisTimer.title)
			.string(printTime(wholeSeconds))
			.toBuffer()
		
		oscOutSock.send(buffer, 0, buffer.length, oscOption.outPort, oscOption.address)
	}
}

function sendSwitch() {
	if ( oscOption.sendSwitch ) {
		const theseSwitches = theTimer.serialize()
		const switchMessages = []
		for ( const [i, thisTimer] of Object.entries(theseSwitches.switches) ) {
			switchMessages.push(oscLib
				.messageBuilder(`/theaterTime/switch/${zPadN(parseInt(i)+1)}`)
				.string(thisTimer.title)
				.string(thisTimer.isOn ? thisTimer.onText : thisTimer.offText)
				.integer(Number(thisTimer.isOn))
				.toBuffer()
			)
		}
		const buffer = oscLib.buildBundle({
			timetag  : oscLib.getTimeTagBufferFromDelta(50/1000),
			elements : switchMessages,
		})
		oscOutSock.send(buffer, 0, buffer.length, oscOption.outPort, oscOption.address)
	}
}

function sendTimer() {
	if ( oscOption.sendTimerStatus ) {
		const theseSwitches = theTimer.serialize()
		const switchMessages = []
		for ( const [i, thisTimer] of Object.entries(theseSwitches.timers) ) {
			switchMessages.push(oscLib
				.messageBuilder(`/theaterTime/timer/${zPadN(parseInt(i)+1)}`)
				.string(thisTimer.title)
				.integer(Number(thisTimer.isOn))
				.toBuffer()
			)
		}
		const buffer = oscLib.buildBundle({
			timetag  : oscLib.getTimeTagBufferFromDelta(50/1000),
			elements : switchMessages,
		})
		oscOutSock.send(buffer, 0, buffer.length, oscOption.outPort, oscOption.address)
	}
}

function printTime (secondsLeft) {
	const timerOverRun = secondsLeft < 0 ? '+ ' : ''
	const absSec     = Math.abs(secondsLeft)

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
		path.join(__dirname, 'current-state.json'),
		JSON.stringify(theTimer.getSaveObject(), null, 2)
	)
}