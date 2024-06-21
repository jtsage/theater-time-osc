/*  ___  _               _            ___  _             
   |_ _|| |_  ___  ___ _| |_ ___  _ _|_ _|<_>._ _ _  ___ 
    | | | . |/ ._><_> | | | / ._>| '_>| | | || ' ' |/ ._>
    |_| |_|_|\___.<___| |_| \___.|_|  |_| |_||_|_|_|\___.
	(c) 2024 J.T.Sage - MIT License
*/
const EventEmitter = require('node:events')
const TOML         = require('fast-toml')
const fs           = require('node:fs')

class Timer extends EventEmitter {
	#safeIDList = new Set()

	#osc  = {
		address         : null,
		inPort          : null,
		outPort         : null,
		sendActiveTimer : false,
		sendSwitch      : false,
		sendTimerStatus : false,
	}
	#http = {
		port : null,
	}
	#show = {
		title    : '',
		subtitle : '',
		date     : null,
	}
	#switches = []
	#timers   = []

	constructor(filename, newDate, newTime) {
		super()

		if ( typeof filename === 'string' && filename.endsWith('toml') ) {
			this.#loadTOML(filename, newDate, newTime)
			//loading new
		} else if (  typeof filename === 'string' && filename.endsWith('json') ) {
			this.#loadJSON(filename)
			// do resume
		} else {
			throw new TypeError('unknown options')
		}

		
	}

	#setString(propName, value) {
		if ( typeof value !== 'string' ) {
			throw new TypeError(`parse error ${propName} must be set`)
		}
		this.#show[propName] = value
	}

	#setOSC(propName, value) {
		if ( typeof value === 'undefined' ) {
			throw new TypeError(`parse error OSC setting ${propName} must be set`)
		}
		this.#osc[propName] = value
	}

	#setHTTP(propName, value) {
		if ( typeof value === 'undefined' ) {
			throw new TypeError(`parse error HTTP setting ${propName} must be set`)
		}
		this.#http[propName] = value
	}

	#loadJSON(filename) {
		const thisLoad = JSON.parse(fs.readFileSync(filename))

		this.#show.date = new Date(thisLoad.date)

		this.#setOSC('address', thisLoad.osc.address)
		this.#setOSC('outPort', thisLoad.osc.outPort)
		this.#setOSC('inPort', thisLoad.osc.inPort)
		this.#setOSC('sendActiveTimer', thisLoad.osc.sendActiveTimer)
		this.#setOSC('sendTimerStatus', thisLoad.osc.sendTimerStatus)
		this.#setOSC('sendSwitch', thisLoad.osc.sendSwitch)

		this.#setHTTP('port', thisLoad.http.port)

		this.#setString('title', thisLoad.title)
		this.#setString('subtitle', thisLoad.subtitle)

		for ( const thisSwitch of thisLoad.switches ) {
			this.addSwitch(thisSwitch.title, thisSwitch.onText, thisSwitch.offText, thisSwitch.isOn)
		}

		for ( const thisTimer of thisLoad.timers ) {
			if ( thisTimer.type === 'count-up' ) {
				this.#timers.push(new TimerCountUp(thisTimer))
			} else if ( thisTimer.type === 'count-down' ) {
				this.#timers.push(new TimerCountDown(thisTimer))
			} else if ( thisTimer.type === 'absolute-down' ) {
				this.#timers.push(new TimerAbsoluteCountDown(thisTimer))
			}
		}
		setTimeout(() => {this.emit('state-save')}, 2500)
	}

	#loadTOML(filename, date, time) {
		const thisLoad = TOML.parseFileSync(filename)

		if ( date === 'today' ) {
			const today = (new Date()).toISOString().slice(0, 10)
			this.#show.date = new Date(`${today} ${time}`)
		} else {
			this.#show.date = new Date(`${date} ${time}`)
		}

		this.#setOSC('address', thisLoad.oscSendAddress)
		this.#setOSC('outPort', thisLoad.oscSendPort)
		this.#setOSC('inPort', thisLoad.oscListenPort)
		this.#setOSC('sendActiveTimer', thisLoad.oscSendActiveTimer)
		this.#setOSC('sendTimerStatus', thisLoad.oscSendTimerStatus)
		this.#setOSC('sendSwitch', thisLoad.oscSendSwitch)

		this.#setHTTP('port', thisLoad.httpPort)

		this.#setString('title', thisLoad.title)
		this.#setString('subtitle', thisLoad.subtitle)

		for ( const thisSwitch of thisLoad.switches ) {
			this.addSwitch(thisSwitch.title, thisSwitch.onText, thisSwitch.offText)
		}

		for ( const thisTimer of thisLoad.timers ) {
			if ( thisTimer.start_countdown === true ) {
				this.addTimer_AbsoluteDown(thisTimer.title, thisTimer.extras)
			} else if ( typeof thisTimer.count_minutes === 'number' ) {
				this.addTimer_CountDown(thisTimer.title, thisTimer.count_minutes, thisTimer.extras)
			} else {
				this.addTimer_CountUp(thisTimer.title, thisTimer.extras)
			}

			if ( typeof thisTimer.reset_switches !== 'undefined' ) {
				this.#timers[this.#timers.length - 1].resetSwitch = thisTimer.reset_switches
			}
		}
		this.#timers[0].on()
		setTimeout(() => {this.emit('state-save')}, 2500)
	}

	#getSafeID(prefix, thisName) {
		const newName = `${prefix}-${thisName.toLowerCase().replace(/[^\dA-Za-z]/, '-')}`
		if ( !this.#safeIDList.has(newName) ) {
			this.#safeIDList.add(newName)
			return newName
		}
		let number = 1
		while ( true ) {
			const testName = `${newName}-${number}`
			if ( ! this.#safeIDList.has(testName) ) {
				this.#safeIDList.add(testName)
				return testName
			}
			number++
		}
	}

	/* Settings GETTERS */
	get OSCSettings() {
		return {
			address         : this.#osc.address,
			inPort          : this.#osc.inPort,
			outPort         : this.#osc.outPort,
			sendActiveTimer : this.#osc.sendActiveTimer,
			sendSwitch      : this.#osc.sendSwitch,
			sendTimerStatus : this.#osc.sendTimerStatus,
		}
	}

	get HTTPSettings() {
		return {
			port : this.#http.port,
		}
	}

	/* Serialization */

	serialize() {
		return {
			date     : typeof this.#show.date?.toISOString !== 'undefined' ? this.#show.date.toISOString() : null,
			subtitle : this.#show.subtitle,
			switches : this.serializeSwitches(),
			timers   : this.serializeTimers(),
			title    : this.#show.title,
		}
	}

	serializeSwitches() {
		return this.#switches.map((x) => x.serialize())
	}

	serializeTimers() {
		return this.#timers.map((x) => x.serialize())
	}

	serializeSave() {
		return {
			...this.serialize(),
			http : this.HTTPSettings,
			osc : this.OSCSettings,
		}
	}

	serializeActive() {
		const returnObject = this.serialize()
		returnObject.timers = returnObject.timers.filter((x) => x.isOn === true)
		return returnObject
	}

	serializeOSCTimer() {
		const currentTimer = this.#getActiveTimerIndex()
		if ( currentTimer !== null ) {
			return this.#timers[currentTimer].oscTimerDetail
		}
		return null
	}

	#switchAction(done = true) {
		this.emit('switch-updated')
		if ( done ) { this.emit('state-save') }
	}

	#timerAction(done = true) {
		this.emit('timer-updated')
		if ( done ) { this.emit('state-save') }
	}

	#getActiveTimerIndex() {
		for ( let i = 0; i < this.#timers.length; i++ ) {
			if ( this.#timers[i].isOn ) { return i }
		}
		return null
	}

	#safeOn(index) {
		if ( index < 0 || index === null ) { return }
		if ( typeof this.#timers[index] !== 'undefined' ) {
			this.#timers[index].on()
		}
	}

	#safeOff(index) {
		if ( index < 0 || index === null ) { return }
		if ( typeof this.#timers[index] !== 'undefined' ) {
			this.#timers[index].off()
		}
	}

	/* Public Switch Actions */

	switchOn(index) {
		if ( typeof this.#switches[index] !== 'undefined' ) {
			this.#switches[index].on()
			this.#switchAction()
		}
	}

	switchOff (index) {
		if ( typeof this.#switches[index] !== 'undefined' ) {
			this.#switches[index].off()
			this.#switchAction()
		}
	}

	switchToggle(index) {
		if ( typeof this.#switches[index] !== 'undefined' ) {
			if ( this.#switches[index].isOn ) {
				this.#switches[index].off()
			} else {
				this.#switches[index].on()
			}
			this.#switchAction()
		}
	}

	/* Public Timer Actions */
	nextTimer() {
		const currentTimer = this.#getActiveTimerIndex()
		if ( currentTimer === null ) {
			this.#safeOn(0)
		} else {
			this.#safeOff(currentTimer)
			this.#safeOn(currentTimer + 1)
		}

		const newTimer = this.#getActiveTimerIndex()
		if ( newTimer !== null ) {
			for ( const thisReset of this.#timers[newTimer].resetSwitch ) {
				for ( const thisSwitch of this.#switches ) {
					if ( thisSwitch.title === thisReset ) {
						thisSwitch.off()
						this.#switchAction(false)
					}
				}
			}
		}
		this.#timerAction()
	}

	prevTimer() {
		const currentTimer = this.#getActiveTimerIndex()
		if ( currentTimer === null ) {
			this.#safeOn(this.#timers.length - 1)
		} else {
			this.#safeOff(currentTimer)
			this.#safeOn(currentTimer - 1)
		}
		this.#timerAction()
	}

	stopAll() {
		const currentTimer = this.#getActiveTimerIndex()
		this.#safeOff(currentTimer)
		this.#timerAction()
	}

	/* Building Tasks */

	addSwitch(title, onText, offText, isOn = false) {
		this.#switches.push(new Switch(
			this.#getSafeID('switch', title),
			title,
			onText,
			offText,
			isOn
		))
	}

	addTimer_AbsoluteDown(title, extras) {
		this.#timers.push(new TimerAbsoluteCountDown(
			null,
			this.#getSafeID('timer', title),
			title,
			this.#show.date,
			extras
		))
	}

	addTimer_CountDown(title, minutes, extras) {
		this.#timers.push(new TimerCountDown(
			null,
			this.#getSafeID('timer', title),
			title,
			minutes,
			extras
		))
	}

	addTimer_CountUp(title, extras) {
		this.#timers.push(new TimerCountUp(
			null,
			this.#getSafeID('timer', title),
			title,
			extras
		))
	}


}

class TimerSTD {
	dateEnd      = null
	dateStart    = null
	dateTarget   = null
	extras       = []
	hasRun       = false
	id           = null
	isComplete   = false
	isOn         = false
	resetSwitch  = []
	timeRemain   = null
	timeTarget   = null
	title        = null
	type         = 'unknown'

	constructor(override, id, title, extras = []) {
		if ( override !== null ) {
			this.dateEnd     = override.dateEnd === null ? null : new Date(override.dateEnd)
			this.dateStart   = override.dateStart === null ? null : new Date(override.dateStart)
			this.dateTarget  = override.dateTarget === null ? null : new Date(override.dateTarget)
			this.extras      = override.extras
			this.hasRun      = override.hasRun
			this.id          = override.id
			this.isComplete  = override.isComplete
			this.isOn        = override.isOn
			this.resetSwitch = override.resetSwitch
			this.timeRemain  = override.timeRemain
			this.timeTarget  = override.timeTarget
			this.title       = override.title
			this.type        = override.type
		} else {
			this.extras = extras
			this.id     = id
			this.title  = title
		}
	}
	
	on()  {
		this.isOn = true
		this.isComplete = false
		this.hasRun = true
		this.dateStart = new Date()
	}

	off() {
		this.isOn = false
		this.isComplete = true
		this.dateEnd = new Date()
	}

	#dateOrNull(value) {
		if ( typeof value?.toISOString !== 'function' ) { return null }
		return value.toISOString()
	}

	tick() {
		if ( this.isComplete || !this.hasRun ) { return this.timeRemain }
		const now = new Date()
		this.timeRemain = Math.floor((this.dateTarget - now)/1000)
		return this.timeRemain
	}

	serialize() {
		return {
			dateEnd      : this.#dateOrNull(this.dateEnd),
			dateStart    : this.#dateOrNull(this.dateStart),
			dateTarget   : this.#dateOrNull(this.dateTarget),
			extras       : this.extras,
			hasRun       : this.hasRun,
			id           : this.id,
			isComplete   : this.isComplete,
			isOn         : this.isOn,
			resetSwitch  : this.resetSwitch,
			timeRemain   : this.timeRemain,
			timeTarget   : this.timeTarget,
			title        : this.title,
			type         : this.type,
		}
	}
}

class TimerCountUp extends TimerSTD {
	constructor(override, id, title, extras = []) {
		if ( override === null ) {
			super(null, id, title, extras)
			this.type = 'count-up'
		} else {
			super(override)
		}
	}

	get oscTimerDetail() {
		return {
			title        : this.title,
			wholeSeconds : Math.floor((new Date() - this.dateStart) / 1000),
		}
	}
}

class TimerCountDown extends TimerSTD {
	constructor(override, id, title, minutes, extras = []) {
		if ( override === null ) {
			super(null, id, title, extras)
			this.type = 'count-down'
			this.timeTarget = minutes
		} else {
			super(override)
		}
	}

	on() {
		super.on()
		this.dateTarget = new Date()
		this.dateTarget.setMinutes(this.dateTarget.getMinutes() + this.timeTarget)
	}

	serialize() {
		return {
			...super.serialize(),
			timeRemain : this.tick(),
		}
	}

	get oscTimerDetail() {
		return {
			title        : this.title,
			wholeSeconds : Math.floor((this.dateTarget - new Date()) / 1000),
		}
	}
}

class TimerAbsoluteCountDown extends TimerSTD {
	constructor(override, id, title, date, extras = []) {
		if ( override === null ) {
			super(null, id, title, extras)
			this.type = 'absolute-down'
			this.dateTarget = date
			super.on()
		} else {
			super(override)
		}
	}

	serialize() {
		return {
			...super.serialize(),
			timeRemain : this.tick(),
		}
	}

	get oscTimerDetail() {
		return {
			title        : this.title,
			wholeSeconds : Math.floor((this.dateTarget - new Date()) / 1000),
		}
	}
}

class Switch {
	#isOn    = false
	#onText  = 'ON'
	#offText = 'OFF'
	#title   = null
	#id      = null

	constructor(id, title = null, onText = null, offText = null, isOn = false) {
		this.#id    = id
		this.#isOn  = isOn
		this.#title = title

		if ( onText !== null )  { this.#onText = onText }
		if ( offText !== null ) { this.#offText = offText }
	}

	get title() { return this.#title }
	get isOn() { return this.#isOn }
	
	on()  { this.#isOn = true }
	off() { this.#isOn = false }

	serialize() {
		return {
			id      : this.#id,
			isOn    : this.#isOn,
			offText : this.#offText,
			onText  : this.#onText,
			title   : this.#title,
		}
	}
}

module.exports = {
	Timer : Timer,
}