odoo.define('alda_calendar.HotelCalendarView', function (require) {
"use strict";
/*
 * Hotel Calendar View
 * GNU Public License
 * Aloxa Solucions S.L. <info@aloxa.eu>
 *     Alexandre Díaz <alex@aloxa.eu>
 */
/* TODO (TOFIX):
 *  1. When change date with filter buttons, the calendar reload two times because datetime-pickers updating.
 *        Easy to resolve if adds 'search' button instead use 'onchange' events.
 */

var Core = require('web.core');
//var data = require('web.data');
var Time = require('web.time');
var Model = require('web.DataModel');
var View = require('web.View');
var Common = require('web.form_common');
//var pyeval = require('web.pyeval');
var ActionManager = require('web.ActionManager');
var Utils = require('web.utils');
var Dialog = require('web.Dialog');

var _t = Core._t;
var _lt = Core._lt;
var QWeb = Core.qweb;
var l10n = _t.database.parameters;

var PUBLIC_PRICELIST_ID = 1; // Hard-Coded public pricelist id
var ODOO_DATETIME_MOMENT_FORMAT = "YYYY-MM-DD HH:mm:ss";
var L10N_DATETIME_MOMENT_FORMAT = Time.strftime_to_moment_format(l10n.date_format + ' ' + l10n.time_format);
var L10N_DATE_MOMENT_FORMAT = Time.strftime_to_moment_format(l10n.date_format);

var HotelCalendarView = View.extend({
	/** VIEW OPTIONS **/
	template: "HotelCalendarView",
    display_name: _lt('Hotel Calendar'),
    icon: 'fa fa-map-marker',
    view_type: "pms",
    searchable: false,
    searchview_hidden: true,
    _model: null,
    // Custom Options
    hcalendar: null,
    reserv_tooltips: {},
    action_manager: null,
    date_begin: null,
    date_end: null,

    /** VIEW METHODS **/
    init: function(parent, dataset, view_id, options) {
        this._super(parent);
        this.ready = $.Deferred();
        this.set_default_options(options);
        this.dataset = dataset;
        this.model = dataset.model;
        this.fields_view = {};
        this.view_id = view_id;
        this.view_type = 'pms';
        this.selected_filters = [];
        this._model = new Model(this.dataset.model);
        this.action_manager = this.findAncestor(function(ancestor){ return ancestor instanceof ActionManager; });
        this.mutex = new Utils.Mutex();
    },    

    view_loading: function(r) {
        return this.load_custom_view(r);
    },

    load_custom_view: function(fv) {
    	/* xml view calendar options */
        var attrs = fv.arch.attrs,
            self = this;
        this.fields_view = fv;

        var edit_check = new Model(this.dataset.model)
        	.call("check_access_rights", ["write", false])
        	.then(function (write_right) {
        		self.write_right = write_right;
        	});
	    var init = new Model(this.dataset.model)
	        .call("check_access_rights", ["create", false])
	        .then(function (create_right) {
	            self.create_right = create_right;
	            self.init_calendar_view().then(function() {
	                //$(window).trigger('resize');
	                self.trigger('hotel_calendar_view_loaded', fv);
	                self.ready.resolve();
	            });
	        });
	    return $.when(edit_check, init);
    },
    
    do_show: function() {
    	var $widget = this.$el.find("#hcal_widget");
        if ($widget) {
        	$(document).find('.oe-control-panel').hide();
        	$widget.show();
        }
        this.do_push_state({});
        return this._super();
    },
    do_hide: function () {
    	var $widget = this.$el.find("#hcal_widget");
        if ($widget) {
        	$(document).find('.oe-control-panel').show();
        	$widget.hide();
        }
        return this._super();
    },
    is_action_enabled: function(action) {
        if (action === 'create' && !this.options.creatable) {
            return false;
        }
        return this._super(action);
    },
    
    destroy: function () {
        $(document).find('.oe-control-panel').show();
        return this._super.apply(this, arguments);
    },
    
    /** CUSTOM METHODS **/
    create_calendar: function(options, pricelist) {
    	var $this = this;
    	// CALENDAR
    	if (this.hcalendar) {
    		delete this.hcalendar;
    	}
		var $widget = this.$el.find("#hcal_widget");
		var $hcal = $widget.find('#hcalendar');
		if ($hcal) { $hcal.remove(); }
		$widget.append("<div id='hcalendar'></div>");
  
		this.hcalendar = new HotelCalendar('#hcalendar', options, pricelist, this.$el[0]);
		this.hcalendar.addEventListener('hcOnChangeDate', function(ev){
			var date_begin = moment(ev.detail.newDate);
			var days = $this.hcalendar.getOptions('days')-1;
			var date_end = date_begin.clone().add(days, 'd');
			
			var $dateTimePickerBegin = $this.$el.find('#pms-search #date_begin');
			var $dateTimePickerEnd = $this.$el.find('#pms-search #date_end');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
			
			$this.reload_hcalendar_reservations();
		});
		this.hcalendar.addEventListener('hcalOnMouseEnterReservation', function(ev){
			var tp = $this.reserv_tooltips[ev.detail.reservationObj.id];
			var arrival_hour = moment.utc(tp[2]).local().format('HH:mm');
			
			var qdict = {
				'name': tp[0],
				'phone': tp[1],
				'arrival_hour': arrival_hour
			};
			
			$(ev.detail.reservationDiv).tooltip({
				animation: true,
				html: true,
				placement: 'bottom',
				title: QWeb.render('HotelCalendar.Tooltip', qdict)
			}).tooltip('show');
		});
		this.hcalendar.addEventListener('hcalOnContextMenuReservation', function(ev){
			var res_id = ev.detail.reservationObj.id;
			$this._model.call('get_formview_id', [res_id]).then(function(view_id){
				var pop = new Common.FormViewDialog($this, {
	                res_model: 'hotel.reservation',
	                res_id: res_id,
	                title: _t("Open: ") + ev.detail.reservationObj.title,
	                view_id: view_id,
	                //readonly: false
	            }).open();
				pop.on('write_completed', $this, function(){
                    $this.trigger('changed_value');
                });
				pop.on('closed', $this, function(){
                    $this.reload_hcalendar_reservations(); // Here because don't trigger 'write_completed' when change state to confirm
                });
			});
		});
		this.hcalendar.addEventListener('hcalOnChangeReservation', function(ev){
			var newReservation = ev.detail.newReserv;
			var oldReservation = ev.detail.oldReserv;
			
			var qdict = {
	            ncheckin: newReservation.startDate.format(L10N_DATETIME_MOMENT_FORMAT),
	            ncheckout: newReservation.endDate.format(L10N_DATETIME_MOMENT_FORMAT),
	            nroom: newReservation.room.number,
	            ocheckin: oldReservation.startDate.format(L10N_DATETIME_MOMENT_FORMAT),
	            ocheckout: oldReservation.endDate.format(L10N_DATETIME_MOMENT_FORMAT),
	            oroom: oldReservation.room.number
	        };
			new Dialog($this, {
                title: _t("Confirm Reservation Changes"),
                buttons: [
                	{
                		text: _t("Yes, change it"),
                		classes: 'btn-primary',
                		close: true,
                		disabled: !newReservation.id,
                		click: function () {
                			var linkedReservations = $this.hcalendar.getLinkedReservations(newReservation).concat(newReservation);
                			var x2xCommands = [];
                			for (var r of linkedReservations) {
                				var room = $this.hcalendar.getRoom(r.room.id);
                				x2xCommands.push([1, r.getUserData('reservation_line_id'), {
                        			//'adults': r.adults,
                        			//'children': r.childrens,
                        			'categ_id': r.room.getUserData('categ_id'),
                        			'name': false,
                        			'reserve': [[6, false, [r.room.id]]]
                        		}]);
                			}

                			var write_values = {
                				'checkin': newReservation.startDate.utc().format(ODOO_DATETIME_MOMENT_FORMAT),
                				'checkout': newReservation.endDate.utc().format(ODOO_DATETIME_MOMENT_FORMAT),
                				'reservation_line': x2xCommands
                			};
                			new Model('hotel.reservation').call('write', [[newReservation.id], write_values]).fail(function(err, ev){
                				$this.hcalendar.swapReservation(newReservation, oldReservation);
                			});
                		}
                	}, 
                	{
                		text: _t("No"),
                		close: true,
                		click: function() {
                			$this.hcalendar.swapReservation(newReservation, oldReservation);
                		}
                	}
                ],
                $content: QWeb.render('HotelCalendar.ConfirmReservationChanges', qdict)
            }).open();			
		});
		this.hcalendar.addEventListener('hcalOnChangeSelection', function(ev){
			var parentRow = document.querySelector(`#${ev.detail.cellStart.dataset.hcalParentRow}`);
			var parentCellStart = document.querySelector(`#${ev.detail.cellStart.dataset.hcalParentCell}`);
			var parentCellEnd = document.querySelector(`#${ev.detail.cellEnd.dataset.hcalParentCell}`);
			var startDate = HotelCalendar.toMoment(parentCellStart.dataset.hcalDate).startOf('day').utc();
			var endDate = HotelCalendar.toMoment(parentCellEnd.dataset.hcalDate).endOf('day').utc();
			var room = $this.hcalendar.getRoom(parentRow.dataset.hcalRoomObjId);
			var numBeds = room.shared?(ev.detail.cellEnd.dataset.hcalBedNum - ev.detail.cellStart.dataset.hcalBedNum)+1:room.capacity;
			
			if (numBeds <= 0) {
				return;
			}
			
			// Normalize Dates
			if (startDate.isAfter(endDate)) {
				var tt = endDate;
				endDate = startDate;
				startDate = tt;
			}
			
			// If start 'today' put the current hour
			var now = moment(new Date()).utc();
			if (startDate.isSame(now, 'day')) {
				startDate = now.add(30,'m'); // +30 mins
			}
			
			new Common.SelectCreateDialog(this, {
                res_model: 'hotel.reservation',
                context: {
                	'default_adults': numBeds,
                	'default_checkin': startDate.format(ODOO_DATETIME_MOMENT_FORMAT),
                	'default_checkout': endDate.format(ODOO_DATETIME_MOMENT_FORMAT),
                	'default_reservation_line': [
                		[0, false, {
                			'adults': numBeds,
                			'children': 0,
                			'categ_id': room.getUserData('categ_id'),
                			'name': false,
                			'reserve': [[6, false, [room.id]]]
                		}]
                	]
                },
                title: _t("Create: ") + _t("Reservation"),
                initial_view: "form",
                create_function: function(data, options) {
                    var def = $.Deferred();
                    var res = true;
                    var dataset = $this.dataset;
                    options = options || {};
                    var internal_options = _.extend({}, options, {'internal_dataset_changed': true});
                    
                    $this.mutex.exec(function(){
                    	return dataset.create(data, internal_options).then(function (id) {
                            dataset.ids.push(id);
                            res = id;
                        });
                    });
                    $this.mutex.def.then(function () {
                        $this.trigger("change:commands", options);
                        def.resolve(res);
                    });
                    
                    return def;
                },
                read_function: function(ids, fields, options) {
                	return $this.dataset.read_ids(ids, fields, options);
                },
                on_selected: function() {
                    $this.generate_hotel_calendar();
                }
            }).open();
		});
		
		this.hcalendar.addEventListener('hcalOnChangeRoomTypePrice', function(ev){
			var qdict = {
				'date':  ev.detail.date.local().format(L10N_DATE_MOMENT_FORMAT),
				'old_price': ev.detail.old_price,
				'new_price': ev.detail.price
			};
			new Dialog($this, {
                title: _t("Confirm Price Change"),
                buttons: [
                	{
                		text: _t("Yes, change it"),
                		classes: 'btn-primary',
                		close: true,
                		disabled: !ev.detail.date,
                		click: function () {
                			var categ_id = $this.hcalendar.getRoomsByType(ev.detail.room_type)[0].getUserData('categ_id');
                			var data = {
                				'pricelist_id': PUBLIC_PRICELIST_ID,
                				'applied_on': '2_product_category',
                				'categ_id': categ_id,
                				'compute_price': 'fixed',
                				'date_start': ev.detail.date.format(ODOO_DATETIME_MOMENT_FORMAT),
                				'date_end': ev.detail.date.format(ODOO_DATETIME_MOMENT_FORMAT),
                				'fixed_price': ev.detail.price,
                				'sequence': 0,
                			};
                			new Model('product.pricelist.item').call('create', [data]).fail(function(err, ev){
                				alert("[Hotel Calendar]\nERROR: Can't update price!");
                				$this.hcalendar.setDetailPrice(ev.detail.room_type, ev.detail.date, ev.detail.old_price);
                			});
                		}
                	}, 
                	{
                		text: _t("No"),
                		close: true,
                		click: function() {
                			$this.hcalendar.setDetailPrice(ev.detail.room_type, ev.detail.date, ev.detail.old_price);
                		}
                	}
                ],
                $content: QWeb.render('HotelCalendar.ConfirmPriceChange', qdict)
            }).open();
		});
    },
    
    generate_hotel_calendar: function(){
    	var $this = this;
    	
    	/** DO MAGIC **/
    	var domains = this.generate_domains();
    	var full_domain = [false, domains['dates'][0], domains['dates'][1], domains['rooms'] || [], domains['reservations'] || []];
    	this._model.call('get_hcalendar_data', full_domain).then(function(results){
    		$this.reserv_tooltips = results['tooltips'];
			var rooms = [];
			for (var r of results['rooms']) {
				var nroom = new HRoom(
					r[0], // Id
					r[1], // Name
					r[2], // Capacity
					r[4], // Category
					r[5]  // Shared Room
				);
				nroom.addUserData({'categ_id': r[3]});
				rooms.push(nroom);
			}
			
			$this.create_calendar({
				rooms: rooms,
				showPaginator: false
			}, results['pricelist']);
			
			var reservs = [];
			for (var r of results['reservations']) {
				var room = $this.hcalendar.getRoom(r[0]);
				var nreserv = new HReservation(
					r[1], // Id
					room, // Room
					r[2], // Title
					r[3], // Adults
					r[4], // Childrens
					moment.utc(r[5]).local(), // Date Start
					moment.utc(r[6]).local(), // Date End
					r[8] // Color
				);
				nreserv.addUserData({'reservation_line_id': r[7]});
				reservs.push(nreserv);
			}
			$this.hcalendar.setReservations(reservs);
		});
    },
    
    call_action: function(action) {
    	this.action_manager.do_action(action);
		$(document).find('.oe-control-panel').show();
    },
    
    get_pms_buttons_counts: function() {
    	this.$el.find('div.ninfo').hide();
    	
    	var domain = [];
    	var $badge = false;
    	
    	// Checkout Button
    	domain = [['checkout', '>=', moment().startOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT)],
			['checkout','<=', moment().endOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT)],
			['state','=','checkin']];

		var $badge_checkout = this.$el.find('#pms-menu #btn_action_checkout .badge');
		this._model.call('search_count', [domain]).then(function(count){
			if (count > 0) {
				$badge_checkout.text(count);
				$badge_checkout.parent().show();
			}
		});
    	
    	// Checkin Button
    	domain = [['checkin', '>=', moment().startOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT)],
						['checkin','<=', moment().endOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT)],
						['state','!=','checkin']];
    	
    	console.log(domain);
    	
    	var $badge_checkin = this.$el.find('#pms-menu #btn_action_checkin .badge');
    	this._model.call('search_count', [domain]).then(function(count){
    		if (count > 0) {
    			$badge_checkin.text(count);
    			$badge_checkin.parent().show();
    		}
    	});
    	
    	// Charges Button
    	domain = [['invoice_status', 'in', ['to invoice', 'no']], ['reservation_id', '!=', false]];
    	
    	var $badge_charges = this.$el.find('#pms-menu #btn_action_paydue .badge');
    	new Model('hotel.folio').call('search_count', [domain]).then(function(count){
    		if (count > 0) {
    			$badge_charges.text(count);
    			$badge_charges.parent().show();
    		}
    	});
    },
    
    init_calendar_view: function(){
    	var $this = this;

		/** HACKISH ODOO VIEW **/
		$(document).find('.oe-view-manager-view-pms').css('overflow', 'initial'); // No Scroll here!
		
		/** VIEW CONTROLS INITIALIZATION **/
		// DATE TIME PICKERS
		var DTPickerOptions = { 
			viewMode: 'months',
			icons : {
                time: 'fa fa-clock-o',
                date: 'fa fa-calendar',
                up: 'fa fa-chevron-up',
                down: 'fa fa-chevron-down'
               },
            language : moment.locale(),
            format : L10N_DATE_MOMENT_FORMAT,
		};
		var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
		var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');
		$dateTimePickerBegin.datetimepicker(DTPickerOptions);
		$dateTimePickerEnd.datetimepicker($.extend({}, DTPickerOptions, { 'useCurrent': false }));
		$dateTimePickerBegin.on("dp.change", function (e) {
			$dateTimePickerEnd.data("DateTimePicker").setMinDate(e.date.add(3,'d'));
			$dateTimePickerEnd.data("DateTimePicker").setMaxDate(e.date.add(2,'M'));
			$this.on_change_filter_date(e, true);
	    });
		$dateTimePickerEnd.on("dp.change", function (e) {
			$this.on_change_filter_date(e, false);
	    });
		//this.$el.find('#pms-search #cal-pag-selector').datetimepicker($.extend({}, DTPickerOptions, { 
		//	'useCurrent': true,
		//}));
		
		//var $dateTimePickerSelector = this.$el.find('#pms-search #cal-pag-selector-calendar');		
		//$dateTimePickerSelector.datetimepicker($.extend({}, DTPickerOptions, {'inline':true, 'sideBySide': false}));
		//$dateTimePickerSelector.on("dp.change", function (e) {
		//	console.log(e);
			/*var date_begin = moment(this.data("DateTimePicker").getDate());
			var days = moment(date_begin).daysInMonth();
			var date_end = date_begin.clone().add(days, 'd');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);*/
	    //});
		
        var date_begin = moment().startOf('day');
		var days = moment(date_begin).daysInMonth();
		var date_end = date_begin.clone().add(days, 'd').endOf('day');
		$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
		$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
		
		// View Events
		this.$el.find("#pms-search #search_query").on('change', function(ev){
			$this.reload_hcalendar_reservations();
		});
		this.$el.find("#pms-search #cal-pag-prev-plus").on('click', function(ev){
			// FIXME: Ugly repeated code. Change place.
			var $dateTimePickerBegin = $this.$el.find('#pms-search #date_begin');
			var $dateTimePickerEnd = $this.$el.find('#pms-search #date_end');
			var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().subtract(15, 'd').startOf('day');
			var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate().subtract(15, 'd').endOf('day');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
			
			ev.preventDefault();
		});
		this.$el.find("#pms-search #cal-pag-prev").on('click', function(ev){
			// FIXME: Ugly repeated code. Change place.
			var $dateTimePickerBegin = $this.$el.find('#pms-search #date_begin');
			var $dateTimePickerEnd = $this.$el.find('#pms-search #date_end');
			var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().subtract(1, 'd').startOf('day');
			var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate().subtract(1, 'd').endOf('day');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);

			ev.preventDefault();
		});
		this.$el.find("#pms-search #cal-pag-next-plus").on('click', function(ev){
			// FIXME: Ugly repeated code. Change place.
			var $dateTimePickerBegin = $this.$el.find('#pms-search #date_begin');
			var $dateTimePickerEnd = $this.$el.find('#pms-search #date_end');
			var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().add(15, 'd').startOf('day');
			var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate().add(15, 'd').endOf('day');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
			
			ev.preventDefault();
		});
		this.$el.find("#pms-search #cal-pag-next").on('click', function(ev){
			// FIXME: Ugly repeated code. Change place.
			var $dateTimePickerBegin = $this.$el.find('#pms-search #date_begin');
			var $dateTimePickerEnd = $this.$el.find('#pms-search #date_end');
			var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().add(1, 'd').startOf('day');
			var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate().add(1, 'd').endOf('day');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
			
			ev.preventDefault();
		});
		this.$el.find("#pms-search #cal-pag-selector").on('click', function(ev){
			// FIXME: Ugly repeated code. Change place.
			var $dateTimePickerBegin = $this.$el.find('#pms-search #date_begin');
			var $dateTimePickerEnd = $this.$el.find('#pms-search #date_end');
			var date_begin = moment().startOf('day');
			var days = moment(date_begin).daysInMonth();
			var date_end = date_begin.clone().add(days, 'd').endOf('day');
			$dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
			$dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
			
			ev.preventDefault();
		});
		
		/* BUTTONS */
		this.get_pms_buttons_counts();
		this.$el.find("#btn_action_checkout").on('click', function(ev){
			$this.call_action('alda_calendar.hotel_reservation_action_checkout');
		});
		this.$el.find("#btn_action_checkin").on('click', function(ev){
			$this.call_action('alda_calendar.hotel_reservation_action_checkin');
		});
		this.$el.find("#btn_action_paydue").on('click', function(ev){
			$this.call_action('alda_calendar.hotel_reservation_action_paydue');
		});
		this.$el.find("#btn_action_refresh").on('click', function(ev){
			window.location.reload();
		});
		
    	/** RENDER CALENDAR **/
		this.generate_hotel_calendar();
		
		/** DATABASE QUERIES **/
		// Get Types
		new Model('hotel.room.type').query(['cat_id','name']).all().then(function(resultsHotelRoomType){
			var $list = $this.$el.find('#pms-search #type_list');
			$list.html('');
			resultsHotelRoomType.forEach(function(item, index){
				$list.append(`<option value="${item.cat_id[0]}">${item.name}</option>`);
			});
			$list.select2();
			$list.on('change', function(ev){
				$this.generate_hotel_calendar();
			});
		});
		// Get Floors
		new Model('hotel.floor').query(['id','name']).all().then(function(resultsHotelFloor){
			var $list = $this.$el.find('#pms-search #floor_list');
			$list.html('');
			resultsHotelFloor.forEach(function(item, index){
				$list.append(`<option value="${item.id}">${item.name}</option>`);
			});
			$list.select2();
			$list.on('change', function(ev){
				$this.generate_hotel_calendar();
			});
		});
		// Get Amenities
		new Model('hotel.room.amenities').query(['id','name']).all().then(function(resultsHotelRoomAmenities){
			var $list = $this.$el.find('#pms-search #amenities_list');
			$list.html('');
			resultsHotelRoomAmenities.forEach(function(item, index){
				$list.append(`<option value="${item.id}">${item.name}</option>`);
			});
			$list.select2();
			$list.on('change', function(ev){
				$this.generate_hotel_calendar();
			});
		});
		// Get Virtual Rooms
		new Model('hotel.virtual.room').query(['id','name']).all().then(function(resultsHotelVirtualRooms){
			var $list = $this.$el.find('#pms-search #virtual_list');
			$list.html('');
			resultsHotelVirtualRooms.forEach(function(item, index){
				$list.append(`<option value="${item.id}">${item.name}</option>`);
			});
			$list.select2();
			$list.on('change', function(ev){
				$this.generate_hotel_calendar();
			});
		});
		
		return $.when();
    },
    
    on_change_filter_date: function(ev, isStartDate) {
    	isStartDate = isStartDate || false;
    	var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
		var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');
		var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate();
		var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate();
    	if (date_begin && date_end && date_begin.isBefore(date_end) && this.hcalendar) {
    		var days = isStartDate?date_begin.daysInMonth():date_end.diff(date_begin,'days')+1;
    		this.hcalendar.setStartDate(date_begin, days);
    		this.reload_hcalendar_reservations();
    	}
    },
    
    reload_hcalendar_reservations: function() {
    	var $this = this;
    	var domains = this.generate_domains();
    	var full_domain = [false, domains['dates'][0], domains['dates'][1], domains['rooms'] || [], domains['reservations'] || [], false];
    	this._model.call('get_hcalendar_data', full_domain).then(function(results){
    		$this.reserv_tooltips = results['tooltips'];
    		var reservs = [];
			for (var r of results['reservations']) {
				var room = $this.hcalendar.getRoom(r[0]);
				var nreserv = new HReservation(
					r[1], // Id
					room, // Room
					r[2], // Title
					r[3], // Adults
					r[4], // Childrens
					moment.utc(r[5]).local(), // Date Start
					moment.utc(r[6]).local(), // Date End
					r[8] // Color
				);
				nreserv.addUserData({'reservation_line_id': r[7]});
				reservs.push(nreserv);
			}
			
			console.log(results['pricelist']);
			$this.hcalendar.pricelist = results['pricelist'];
			$this.hcalendar.setReservations(reservs);
		});
    },
    
    generate_domains: function() {
    	var domainRooms = [];
    	var category = this.$el.find('#pms-search #type_list').val();
    	if (category) { domainRooms.push(['categ_id.id', 'in', category]); }
    	var floor = this.$el.find('#pms-search #floor_list').val();
    	if (floor) { domainRooms.push(['floor_id.id', 'in', floor]); }
    	var amenities = this.$el.find('#pms-search #amenities_list').val();
    	if (amenities) { domainRooms.push(['room_amenities.id', 'in', amenities]); }
    	var virtual = this.$el.find('#pms-search #virtual_list').val();
    	if (virtual) { domainRooms.push(['virtual_rooms.id', 'in', virtual]); }
    	
    	var domainReservations = [];
    	var search_query = this.$el.find('#pms-search #search_query').val();
    	if (search_query) {
    		domainReservations.push('|');
    		domainReservations.push('|');
    		domainReservations.push(['partner_id.name', 'ilike', search_query]);
    		domainReservations.push(['partner_id.phone', 'ilike', search_query]);
    		domainReservations.push(['partner_id.mobile', 'ilike', search_query]);
    	}
    	
    	var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
		var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');
	
    	var date_begin = moment($dateTimePickerBegin.data("DateTimePicker").getDate()).startOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT);
    	var date_end = moment($dateTimePickerEnd.data("DateTimePicker").getDate()).endOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT);

    	return {
    		'rooms': domainRooms,
    		'reservations': domainReservations,
    		'dates': [date_begin, date_end]
    	};
    }
});

Core.view_registry.add('pms', HotelCalendarView);
return HotelCalendarView;

});
