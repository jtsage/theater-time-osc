/*  ___  _               _            ___  _             
   |_ _|| |_  ___  ___ _| |_ ___  _ _|_ _|<_>._ _ _  ___ 
    | | | . |/ ._><_> | | | / ._>| '_>| | | || ' ' |/ ._>
    |_| |_|_|\___.<___| |_| \___.|_|  |_| |_||_|_|_|\___.
	(c) 2024 J.T.Sage - MIT License
*/

let payload_data = null
let autoRefresh  = null
const timerIntervals = []

const dateObjects  = {
	showStart : null,
	timer     : null,
}


const byID      = (elementID) => document.getElementById(elementID)
const zPadN     = (num) => num.toString().padStart(2, 0)
const printTime = (secondsLeft, alwaysHour = false, noSign = false) => {
	const isNegative = noSign ? '' : secondsLeft < 0 ? '+ ' : ''
	const absSec     = Math.abs(secondsLeft)

	const hr_hourLeft = Math.floor(absSec / 60 / 60)
	const hr_minLeft  = Math.floor((absSec - hr_hourLeft*60*60) / 60)
	const hr_secLeft  = Math.floor(absSec - ((hr_hourLeft*60*60) + (hr_minLeft*60)))

	if ( !alwaysHour && hr_hourLeft === 0 ) {
		return `${isNegative}${zPadN(hr_minLeft)}:${zPadN(hr_secLeft)}`
	}
	return `${isNegative}${hr_hourLeft}:${zPadN(hr_minLeft)}:${zPadN(hr_secLeft)}`
}
const hour12 = (date) => {
	if ( date.getHours() === 0 ) { return [12, 'AM']}
	if ( date.getHours() <= 12 ) { return [date.getHours(), 'AM']}
	return [date.getHours() - 12, 'PM']
}
const printDate = (date) => {
	if ( typeof date?.toISOString !== 'function' ) { return '' }
	const hours = hour12(date)
	return [
		date.getFullYear(), '-',
		zPadN(date.getMonth() + 1), '-',
		zPadN(date.getDate()), ' ',
		zPadN(hours[0]), ':',
		zPadN(date.getMinutes()),
		hours[1]
	].join('')
}


const updatePageTitles = () => {
	dateObjects.showStart = new Date(payload_data.date)
	byID('dyn_event_title').innerHTML    = payload_data.title
	byID('dyn_event_subtitle').innerHTML = payload_data.subtitle
	byID('dyn_time_start').innerHTML     = `${dateObjects.showStart.getHours()%12 ? dateObjects.showStart.getHours()%12 : 12}:${dateObjects.showStart.getMinutes().toString().padStart(2, 0)} ${dateObjects.showStart.getHours()>11?'PM':'AM'}`
}

const updateSwitches = () => {
	const templateHTML = byID('template-switch').innerHTML
	const newHTML      = []

	for ( const thisSwitch of payload_data.switches ) {
		newHTML.push(templateHTML
			.replaceAll('{{title}}', thisSwitch.title)
			.replaceAll('{{text}}', thisSwitch.isOn ? thisSwitch.onText : thisSwitch.offText)
			.replaceAll('{{color}}', thisSwitch.isOn ? 'success' : 'danger')
		)
	}
	byID('dyn_switch_contain').innerHTML = newHTML.join('')
}

const updateTimerAdmin = () => {
	const timerHTML = []

	for ( const thisTimer of payload_data.timers ) {
		const timerTemplate = byID('template-timer').innerHTML

		let string_startTime = ''
		let string_endTime   = ''
		let string_time      = ''
		let string_color     = 'text-bg-primary'
		let string_extras    = ''

		if ( !thisTimer.hasRun ) {
			string_color = 'text-bg-dark'
			if ( thisTimer.type === 'count-down' ) {
				string_time = `00:${zPadN(thisTimer.timeTarget)}:00`
			} else {
				string_time = '00:00:00'
			}
		}

		if ( thisTimer.isComplete ) {
			const endDate = new Date(thisTimer.dateEnd)
			const startDate = new Date(thisTimer.dateStart)
			const targetDate = new Date(thisTimer.dateTarget)
			string_endTime = printDate(endDate)
			string_color   = 'text-bg-dark'

			if ( thisTimer.type !== 'absolute-down' ) {
				string_startTime = printDate(startDate)
			}

			if ( thisTimer.type === 'absolute-down' ) {
				const total = (targetDate - endDate)/1000
				string_time = `${total < 0 ? 'LATE' : 'EARLY'}: ${printTime(total, true, true)}`
			} else if ( thisTimer.type === 'count-down' ) {
				string_time = `TOTAL : ${printTime((endDate - startDate)/1000, true)}`
			} else { // count-up
				string_time = `TOTAL : ${printTime((endDate - startDate)/1000, true)}`
			}
		} else {
			string_extras = thisTimer.extras.join(', ')
		}

		if ( thisTimer.isOn ) {
			if ( thisTimer.type !== 'absolute-down' ) {
				const startDate = new Date(thisTimer.dateStart)
				string_startTime = printDate(startDate)
			}
			switch (thisTimer.type ) {
				case 'count-down' :
				case 'absolute-down' : {
					const theDate      = new Date(thisTimer.dateTarget)
					const wholeSeconds = Math.floor((theDate - new Date()) / 1000)
					string_time = printTime(wholeSeconds)
					if ( wholeSeconds < 0 ) { string_color = 'text-bg-danger' }
					
					timerIntervals.push(setInterval(() => {
						const wholeSeconds2 = Math.floor((theDate - new Date()) / 1000)
						byID(`dyn_timer_time-${thisTimer.id}`).innerText = printTime(wholeSeconds2)
						if ( wholeSeconds2 < 0 ) {
							byID(`timer_box-${thisTimer.id}`).classList.remove('text-bg-primary')
							byID(`timer_box-${thisTimer.id}`).classList.add('text-bg-danger')
						} else {
							byID(`timer_box-${thisTimer.id}`).classList.add('text-bg-primary')
							byID(`timer_box-${thisTimer.id}`).classList.remove('text-bg-danger')
						}
					}, 1000))
					break
				}
				//case 'count-up' :
				default : {
					const theDate = new Date(thisTimer.dateStart)
					const wholeSeconds = Math.floor((new Date() - theDate) / 1000)
					string_time = printTime(wholeSeconds)

					const updateTime = () => {
						const wholeSeconds2 = Math.floor((new Date() - theDate) / 1000)
						byID(`dyn_timer_time-${thisTimer.id}`).innerText = printTime(wholeSeconds2)
					}
					timerIntervals.push(setInterval(updateTime, 1000))
					break
				}
			}
		}


		timerHTML.push(timerTemplate
			.replaceAll('{{id}}', thisTimer.id)
			.replaceAll('{{title}}', thisTimer.title)
			.replaceAll('{{time}}', string_time)
			.replaceAll('{{endTime}}', string_endTime)
			.replaceAll('{{startTime}}', string_startTime)
			.replaceAll('{{showEndTime}}', string_endTime === '' ? 'd-none' : '')
			.replaceAll('{{showStartTime}}', string_startTime === '' ? 'd-none' : '')
			.replaceAll('{{showExtras}}', string_extras === '' ? 'd-none' : '')
			.replaceAll('{{extras}}', string_extras)
			.replaceAll('{{color}}', string_color)
			.replaceAll('{{iconName}}', `icon-${thisTimer.type}`)
		)
	}
	byID('dyn_timer_contain').innerHTML = timerHTML.join('')
}

const updateTimer = () => {
	if ( payload_data.timers.length !== 1 ) {
		byID('dyn_timer_done').classList.remove('d-none')
		byID('dyn_running_timer').classList.add('d-none')
		return
	}

	byID('dyn_timer_done').classList.add('d-none')
	byID('dyn_running_timer').classList.remove('d-none')

	const thisTimer = payload_data.timers[0]

	byID('dyn_timer_title').innerText = thisTimer.title
	byID('dyn_running_timer').classList.remove('icon-count-down', 'icon-absolute-down', 'icon-count-up')
	byID('dyn_running_timer').classList.add(`icon-${thisTimer.type}`)

	switch (thisTimer.type ) {
		case 'count-down' :
		case 'absolute-down' : {
			dateObjects.timer = new Date(thisTimer.dateTarget)
			
			const updateTime = () => {
				const wholeSeconds = Math.floor((dateObjects.timer - new Date()) / 1000)
				byID('dyn_timer_time').innerText = printTime(wholeSeconds)
				if ( wholeSeconds < 0 ) {
					byID('dyn_running_timer').classList.remove('text-bg-primary')
					byID('dyn_running_timer').classList.add('text-bg-danger')
				} else {
					byID('dyn_running_timer').classList.add('text-bg-primary')
					byID('dyn_running_timer').classList.remove('text-bg-danger')
				}
			}
			updateTime()
			timerIntervals.push(setInterval(updateTime, 1000))
			break
		}
		//case 'count-up' :
		default : {
			byID('dyn_running_timer').classList.add('text-bg-primary')
			byID('dyn_running_timer').classList.remove('text-bg-danger')
			dateObjects.timer = new Date(thisTimer.dateStart)
			const updateTime = () => {
				const wholeSeconds = Math.floor((new Date() - dateObjects.timer) / 1000)
				byID('dyn_timer_time').innerText = printTime(wholeSeconds)
			}
			updateTime()
			timerIntervals.push(setInterval(updateTime, 1000))
			break
		}
	}
}

const updatePageInfo = (isAdmin) => {
	updatePageTitles()
	updateSwitches()
	if ( isAdmin ) {
		updateTimerAdmin()
	} else {
		updateTimer()
	}
}


// eslint-disable-next-line no-unused-vars
const getData = (isAdmin = false) => {
	if ( autoRefresh !== null ) {
		clearTimeout(autoRefresh)
		autoRefresh = null
	}

	fetch(`/api/read/${isAdmin?'admin':'remote'}`)
		.then( (response) => {
			if (response.status !== 200) {
				byID('dyn_error_offline').classList.remove('d-none')
				return
			}

			response.json().then((data) => {
				const refreshTime = isAdmin ? 5000 : 2000
				autoRefresh       = setTimeout(() => { getData(isAdmin) }, refreshTime)
				payload_data      = data.message
				byID('dyn_error_offline').classList.add('d-none')

				while ( timerIntervals.length !==  0 ) {
					clearInterval(timerIntervals.pop())
				}
				
				updatePageInfo(isAdmin)
			})
		}).catch( () => {
			byID('dyn_error_offline').classList.remove('d-none')
			autoRefresh = setTimeout(getData, 5 * 60 * 1000)
		})
}
