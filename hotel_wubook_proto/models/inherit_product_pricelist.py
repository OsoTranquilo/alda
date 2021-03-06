# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) 2017 Solucións Aloxa S.L. <info@aloxa.eu>
#                       Alexandre Díaz <dev@redneboa.es>
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#
#    You should have received a copy of the GNU General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################
from openerp import models, fields, api
from openerp.exceptions import ValidationError
from openerp.tools import DEFAULT_SERVER_DATE_FORMAT
from datetime import datetime, timedelta


class ProductPricelist(models.Model):
    _inherit = 'product.pricelist'

    wpid = fields.Char("WuBook Plan ID", readonly=True)
    wdaily = fields.Boolean("WuBook Daily Plan", default=True)


    @api.multi
    def get_wubook_prices(self):
        self.ensure_one()
        prices = {}
        if self.wdaily:
            min_date = False
            max_date = False
            for item in self.item_ids:
                if not item.date_start or not item.date_end:
                    continue
                date_start_dt = fields.Datetime.from_string(item.date_start)
                date_end_dt = fields.Datetime.from_string(item.date_end)
                if not min_date or date_start_dt < min_date:
                    min_date = date_start_dt
                if not max_date or date_end_dt > max_date:
                    max_date = date_end_dt
            if not min_date or not max_date:
                return prices
            days_diff = abs((max_date - min_date).days)
            vrooms = self.env['hotel.virtual.room'].search([('wrid', '!=', 'none')])
            for vroom in vrooms:
                prices.update({vroom.wrid: []})
                for i in range(0, days_diff or 1):
                    ndate_dt = min_date + timedelta(days=i)
                    product_id = vroom.product_id.with_context(
                        quantity=1,
                        date=ndate_dt.strftime(DEFAULT_SERVER_DATE_FORMAT),
                        pricelist=self.id,
                        uom=vroom.product_id.product_tmpl_id.uom_id.id)
                    prices[vroom.wrid].append(product_id.price)
        else:
            vrooms = self.env['hotel.virtual.room'].search([('wrid', '!=', 'none')])
            for item in self.item_ids:
                if not item.date_start or not item.date_end:
                    continue
                date_start_dt = fields.Datetime.from_string(item.date_start)
                date_end_dt = fields.Datetime.from_string(item.date_end)
                days_diff = abs((date_end_dt - date_start_dt).days)
                vals = {}
                for vroom in vrooms:
                    wdays = [False, False, False, False, False, False, False]
                    for i in range(0, 7):
                        ndate_dt = date_start_dt + timedelta(days=i)
                        product_id = vroom.product_id.with_context(
                            quantity=1,
                            date=ndate_dt.strftime(DEFAULT_SERVER_DATE_FORMAT),
                            pricelist=self.id,
                            uom=vroom.product_id.product_tmpl_id.uom_id.id)
                        wdays[ndate_dt.weekday()] = product_id.price
                    vals.update({vroom.wrid: wdays})
                prices.update({
                    'dfrom': item.date_start,
                    'dto': item.date_end,
                    'values': vals,
                })
        return prices

    @api.model
    def create(self, vals):
        if self._context.get('wubook_action', True):
            wpid = self.env['wubook'].create_plan(vals['name'],
                                                  vals.get('wdaily') and 1 or 0)
            if not wpid:
                raise ValidationError("Can't create plan on WuBook")
            vals.update({'wpid': wpid})
        pricelist = super(ProductPricelist, self).create(vals)
#         if self._context.get('wubook_action', True):
#             prices = pricelist.get_wubook_prices()
#             if any(prices):
#                 self.env['wubook'].update_plan_periods(pricelist.wpid, prices)
        return pricelist

    @api.multi
    def write(self, vals):
        nname = vals.get('name')
        if self._context.get('wubook_action', True) and nname:
            for record in self:
                wres = self.env['wubook'].update_plan_name(vals.get('wpid', record.wpid),
                                                           nname)
                if not wres:
                    raise ValidationError("Can't update plan name on WuBook")
        updated = super(ProductPricelist, self).write(vals)
#         if updated and self._context.get('wubook_action', True):
#             pricelist = self.browse(self.id)
#             prices = self.get_wubook_prices()
#             if any(prices):
#                 self.env['wubook'].update_plan_periods(pricelist.wpid, prices)
        return updated

    @api.multi
    def unlink(self):
        if self._context.get('wubook_action', True):
            for record in self:
                wres = self.env['wubook'].delete_plan(record.wpid)
                if not wres:
                    raise ValidationError("Can't delete plan on WuBook")
        return super(ProductPricelist, self).unlink()

    @api.multi
    def import_price_plans(self):
        return self.env['wubook'].import_pricing_plans()
