odoo.define('hotel_calendar_wubook.HotelCalendarViewWuBook', function(require) {
'use strict';
/*
 * Hotel Calendar WuBook View
 * GNU Public License
 * Aloxa Solucions S.L. <info@aloxa.eu>
 *     Alexandre Díaz <alex@aloxa.eu>
 */

var HotelCalendarView = require('hotel_calendar.HotelCalendarView');
var Model = require('web.DataModel');
var Common = require('web.form_common');
var Core = require('web.core');

var _t = Core._t;

var HotelCalendarViewWuBook = HotelCalendarView.include({
	calc_buttons_counts: function() {
		var res = this._super();
		
		// Cloud Reservations
    	var $button = this.$el.find("#btn_channel_manager_request");
    	var $text = this.$el.find("#btn_channel_manager_request .cloud-text");
    	$text.hide();
    	$button.removeClass('incoming');
    	var domain = [['wrid', '!=', 'none'], ['to_assign', '=', true]];
    	new Model('hotel.reservation').call('search_count', [domain]).then(function(count){
			if (count > 0) {
				$button.addClass('incoming');
				$text.text(count);
				$text.show();
			}
		});
    	
    	return res;
	},
	
	init_calendar_view: function() {
		var res = this._super();
		var $this = this;
		this.$el.find("#btn_channel_manager_request").on('click', function(ev){
			var pop = new Common.SelectCreateDialog($this, {
                res_model: 'hotel.reservation',
                domain: [['wrid', '!=', 'none'], ['to_assign', '=', true]],
                title: _t("WuBook Reservations to Assign"),
                disable_multiple_selection: true,
                no_create: true,
                on_selected: function(element_ids) {
                	return new Model('hotel.reservation').call('get_formview_id', [element_ids]).then(function(view_id){
        				var pop = new Common.FormViewDialog($this, {
        	                res_model: 'hotel.reservation',
        	                res_id: element_ids[0],
        	                title: _t("Open: ") + _t("Reservation"),
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
                }
            }).open();
		});
		return res;
	}
});

return HotelCalendarViewWuBook;

});
