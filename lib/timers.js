/*  ___  _               _            ___  _             
   |_ _|| |_  ___  ___ _| |_ ___  _ _|_ _|<_>._ _ _  ___ 
    | | | . |/ ._><_> | | | / ._>| '_>| | | || ' ' |/ ._>
    |_| |_|_|\___.<___| |_| \___.|_|  |_| |_||_|_|_|\___.
	(c) 2024 J.T.Sage - MIT License
*/
const EventEmitter = require('node:events')
const TOML         = require('@iarna/toml')
const fs           = require('node:fs')
const path         = require('node:path')
const sound        = require('sound-play')

// MARK: Timer Class
class Timer extends EventEmitter {
	#safeIDList = new Set()

	#osc  = {
		address         : '127.0.0.1',
		blinkExpired    : false,
		inPort          : 4488,
		outPort         : 4444,
		sendActiveTimer : true,
		sendSwitch      : true,
		sendTimerStatus : true,
		sendToggle      : true,
	}
	#http = {
		port : 2222,
	}
	#show = {
		date     : null,
		subtitle : '',
		title    : '',
	}
	#switches = []
	#timers   = []
	#audio = {
		timer_05 : '5min.wav',
		timer_10 : '10min.wav',
		timer_15 : '15min.wav',
		timer_20 : '20min.wav',
		timer_30 : '30min.wav',
		use      : true,
		volume   : 0.5,
	}

	constructor(filename, newDate, newTime, resume = false) {
		super()

		if ( typeof filename === 'string' && filename.endsWith('toml') ) {
			this.#loadTOML(filename, newDate, newTime, resume)
			//loading new or saved state
		} else {
			throw new TypeError('unknown options')
		}
	}

	/// Set string (pedigree) - error on unknown value
	#requiredValue(propName, value) {
		if ( typeof value === 'undefined' ) {
			throw new TypeError(`parse error ${propName} must be set`)
		}
		this.#show[propName] = value
	}

	/// Override default value (if set)
	#overrideOSCDefault(propName, value) {
		if ( typeof value !== 'undefined' ) { this.#osc[propName] = value }
	}

	/// Override default value (if set)
	#overrideAudioDefault(propName, value) {
		if ( typeof value !== 'undefined' ) { this.#audio[propName] = value }
	}

	/// Override default value (if set)
	#overrideHTTPDefault(propName, value) {
		if ( typeof value !== 'undefined' ) { this.#http[propName] = value }
	}

	#loadTOML(filename, date, time, resume = false) {
		const thisLoad = TOML.parse(fs.readFileSync(filename))

		if ( resume ) {
			this.#show.date = thisLoad.show.date
		} else if ( date === 'today' ) {
			const today = (new Date()).toISOString().slice(0, 10)
			this.#show.date = new Date(`${today} ${time}`)
		} else {
			this.#show.date = new Date(`${date} ${time}`)
		}

		this.#overrideOSCDefault('address',         thisLoad.osc?.sendAddress)
		this.#overrideOSCDefault('outPort',         thisLoad.osc?.sendPort)
		this.#overrideOSCDefault('inPort',          thisLoad.osc?.listenPort)
		this.#overrideOSCDefault('sendActiveTimer', thisLoad.osc?.sendActiveTimer)
		this.#overrideOSCDefault('sendTimerStatus', thisLoad.osc?.sendTimerStatus)
		this.#overrideOSCDefault('sendSwitch',      thisLoad.osc?.sendSwitch)
		this.#overrideOSCDefault('sendToggle',      thisLoad.osc?.sendToggle)
		this.#overrideOSCDefault('blinkExpired',    thisLoad.osc?.blinkExpired)

		this.#overrideHTTPDefault('port', thisLoad.httpPort)

		this.#overrideAudioDefault('timer_05', thisLoad.audio?.timer_05)
		this.#overrideAudioDefault('timer_10', thisLoad.audio?.timer_10)
		this.#overrideAudioDefault('timer_15', thisLoad.audio?.timer_15)
		this.#overrideAudioDefault('timer_20', thisLoad.audio?.timer_20)
		this.#overrideAudioDefault('timer_30', thisLoad.audio?.timer_30)
		this.#overrideAudioDefault('volume',   thisLoad.audio?.volume)
		this.#overrideAudioDefault('use',      thisLoad.audio?.use)

		this.#requiredValue('title',    thisLoad.show?.title)
		this.#requiredValue('subtitle', thisLoad.show?.subtitle)

		for ( const thisSwitch of thisLoad.switches ) {
			this.addSwitch(thisSwitch)
		}

		for ( const thisTimer of thisLoad.timers ) {
			const resumeObj = resume ? thisTimer : null
			if ( thisTimer.startCountDown === true ) {
				this.addTimer_AbsoluteDown(resumeObj, thisTimer.title, thisTimer.extras)
			} else if ( typeof thisTimer.countMinutes === 'number' ) {
				this.addTimer_CountDown(resumeObj, thisTimer.title, thisTimer.countMinutes, thisTimer.extras)
			} else {
				this.addTimer_CountUp(resumeObj, thisTimer.title, thisTimer.extras)
			}

			if ( typeof thisTimer.resetSwitches !== 'undefined' && ! resume ) {
				this.#timers[this.#timers.length - 1].resetSwitches = thisTimer.resetSwitches
			}
			
		}
		if ( !resume ) { this.#timers[0].on() }
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
	get OSCSettings() { return this.#osc }

	get audioSettings() { return this.#audio }

	get HTTPSettings() { return this.#http }

	// MARK: _serial

	get serialize() {
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

	get serializeSave() {
		return {
			audio    : this.audioSettings,
			http     : this.HTTPSettings,
			osc      : this.OSCSettings,
			show     : this.#show,
			switches : this.serializeSwitches(),
			timers   : this.serializeTimers(),
		}
	}

	serializeActive() {
		const returnObject = this.serialize
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

	serializeAudioTimer() {
		const currentTimer = this.#getActiveTimerIndex()
		if ( currentTimer !== null ) {
			return this.#timers[currentTimer].audioTimerDetail
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

	// MARK: _OSC Switch

	switchOn(index) {
		if ( typeof this.#switches[index] !== 'undefined' ) {
			this.#switches[index].on()
			this.audioPlaySwitch(index)
			this.#switchAction()
			for ( const thisReset of this.#switches[index].resetSwitch ) {
				for ( const thisSwitch of this.#switches ) {
					if ( thisSwitch.title === thisReset ) {
						thisSwitch.off()
						this.#switchAction(false)
					}
				}
			}
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
				this.switchOff(index)
			} else {
				this.switchOn(index)
			}
		}
	}

	// MARK: _OSC Timer
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
			for ( const thisReset of this.#timers[newTimer].resetSwitches ) {
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

	resetAll() {
		this.#timers.map((x) => x.reset())
		this.#switches.map((x) => x.off())
		this.#safeOn(0)
	}

	// MARK: _OSC Other
	changeStart(day = 0, hour = 0, minute = 0) {
		this.#timers[0].dateTarget.setDate(this.#timers[0].dateTarget.getDate() + day )
		this.#timers[0].dateTarget.setHours(this.#timers[0].dateTarget.getHours() + hour )
		this.#timers[0].dateTarget.setMinutes(this.#timers[0].dateTarget.getMinutes() + minute )
	}

	updateTitle(text) {
		this.#show.title = text
		
	}

	updateSubtitle(text) {
		this.#show.subtitle = text
	}

	// MARK: _build
	addSwitch(thisSwitch) {
		this.#switches.push(new Switch(
			this.#getSafeID('switch', thisSwitch.title),
			thisSwitch
		))
	}

	addTimer_AbsoluteDown(resumeObj, title, extras) {
		this.#timers.push(new TimerAbsoluteCountDown(
			resumeObj,
			this.#getSafeID('timer', title),
			title,
			this.#show.date,
			extras
		))
	}

	addTimer_CountDown(resumeObj, title, minutes, extras) {
		this.#timers.push(new TimerCountDown(
			resumeObj,
			this.#getSafeID('timer', title),
			title,
			minutes,
			extras
		))
	}

	addTimer_CountUp(resumeObj, title, extras) {
		this.#timers.push(new TimerCountUp(
			resumeObj,
			this.#getSafeID('timer', title),
			title,
			extras
		))
	}


	// MARK: _audio
	audioPlayTimer(timeInSeconds) {
		let fileName = null
		switch ( timeInSeconds ) {
			case 1800 :
				fileName = this.#audio.timer_30
				break
			case 1200 :
				fileName = this.#audio.timer_20
				break
			case 900 :
				fileName = this.#audio.timer_15
				break
			case 600 :
				fileName = this.#audio.timer_10
				break
			case 300 :
				fileName = this.#audio.timer_05
				break
			default :
				return
		}
		if ( fileName !== null ) {
			const full_path = path.join(__dirname, '..', 'sound_clips', fileName)
			sound.play(
				path.join(__dirname, '..', 'sound_clips', 'chimes.wav'),
				this.#audio.volume
			).then(() => {
				sound.play(
					full_path,
					this.#audio.volume
				).then(() => process.stdout.write(`Played: ${full_path}`))
			})
		}
	}

	audioPlaySwitch(index) {
		if ( this.#switches[index].audio !== null && this.#audio.use ) {
			sound.play(
				path.join(__dirname, '..', 'sound_clips', 'chimes.wav'),
				this.#audio.volume
			).then(() => {
				sound.play(
					path.join(__dirname, '..', 'sound_clips', this.#switches[index].audio),
					this.#audio.volume
				)
			})
		}
	}


}

// MARK: Timer Class
class TimerSTD {
	dateEnd       = null
	dateStart     = null
	dateTarget    = null
	extras        = []
	hasRun        = false
	id            = null
	isComplete    = false
	isOn          = false
	resetSwitches = []
	timeRemain    = null
	timeTarget    = null
	title         = null
	type          = 'unknown'

	constructor(override, id, title, extras = []) {
		if ( override !== null ) {
			this.dateEnd       = typeof override.dateEnd    === 'undefined' ? null : new Date(override.dateEnd)
			this.dateStart     = typeof override.dateStart  === 'undefined' ? null : new Date(override.dateStart)
			this.dateTarget    = typeof override.dateTarget === 'undefined' ? null : new Date(override.dateTarget)
			this.extras        = override.extras
			this.hasRun        = override.hasRun
			this.id            = override.id
			this.isComplete    = override.isComplete
			this.isOn          = override.isOn
			this.resetSwitches = override.resetSwitches
			this.timeRemain    = override.timeRemain
			this.timeTarget    = override.timeTarget
			this.title         = override.title
			this.type          = override.type
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

	reset() {
		this.isOn       = false
		this.isComplete = false
		this.hasRun     = false
		this.dateStart  = null
		this.dateEnd    = null
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
			dateEnd       : this.#dateOrNull(this.dateEnd),
			dateStart     : this.#dateOrNull(this.dateStart),
			dateTarget    : this.#dateOrNull(this.dateTarget),
			extras        : this.extras,
			hasRun        : this.hasRun,
			id            : this.id,
			isComplete    : this.isComplete,
			isOn          : this.isOn,
			resetSwitches : this.resetSwitches,
			timeRemain    : this.timeRemain,
			timeTarget    : this.timeTarget,
			title         : this.title,
			type          : this.type,
		}
	}
}

// MARK: TimerCountUp
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
			type         : this.type,
		}
	}

	get audioTimerDetail() {
		return {
			title        : this.title,
			wholeSeconds : Math.floor((new Date() - this.dateStart) / 1000),
			type         : this.type,
		}
	}
}

// MARK: TimerCountDown
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
		this.dateTarget.setSeconds(this.dateTarget.getSeconds() + 2)
	}

	reset() {
		super.reset()
		this.dateTarget = null
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
			type         : this.type,
		}
	}

	get audioTimerDetail() {
		return {
			title        : this.title,
			type         : this.type,
			wholeSeconds : Math.floor((this.dateTarget - new Date()) / 1000),
		}
	}
}

// MARK: TimerABSCountDown
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
			type         : this.type,
		}
	}

	get audioTimerDetail() {
		return {
			title        : this.title,
			type         : this.type,
			wholeSeconds : Math.floor((this.dateTarget - new Date()) / 1000),
		}
	}
}

//MARK: Switch Class
class Switch {
	#audioFile    = null
	#isOn         = false
	#onText       = 'ON'
	#offText      = 'OFF'
	#title        = null
	#id           = null
	resetSwitches = []
	reverseColor  = false

	constructor(id, thisSwitch) {
		this.#id          = id
		this.#isOn        = thisSwitch?.isOn || false
		this.#title       = thisSwitch.title
		this.#audioFile   = thisSwitch?.audioFile || null
		this.reverseColor = thisSwitch?.reverseColor || false

		if ( typeof thisSwitch?.resetSwitches === 'object' ) { this.resetSwitches = thisSwitch.resetSwitches }

		this.#onText  = thisSwitch?.onText || 'ON'
		this.#offText = thisSwitch?.offText || 'OFF'
	}

	get title() { return this.#title }
	get isOn()  { return this.#isOn }
	get audio() { return this.#audioFile }
	
	on()  { this.#isOn = true  }
	off() { this.#isOn = false }

	serialize() {
		return {
			audioFile      : this.#audioFile,
			id             : this.#id,
			isOn           : this.#isOn,
			offText        : this.#offText,
			onText         : this.#onText,
			resetSwitches  : this.resetSwitches,
			reverseColor   : this.reverseColor,
			title          : this.#title,
		}
	}
}

module.exports = {
	Timer : Timer,
}