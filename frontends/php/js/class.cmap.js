/*!
 * This file is part of Zabbix software
 *
 * Copyright 2000-2011, Zabbix SIA
 * Licensed under the GPL Version 2 license.
 * http://www.zabbix.com/licence.php
 */

var ZABBIX = ZABBIX || {};
ZABBIX.namespace = function(namespace){
	var parts = namespace.split('.'),
		parent = this,
		i;

	for(i = 0; i < parts.length; i++){
		if(typeof parent[parts[i]] === "undefined") {
			parent[parts[i]] = {};
		}
		parent = parent[parts[i]];
	}
	return parent;
};

ZABBIX.namespace('classes.Observer');
ZABBIX.classes.Observer = (function(){
	"use strict";

	var Observer = function(){
		this.listeners = {}
	};
	Observer.prototype = {
		constructor: ZABBIX.classes.Observer,

		bind: function(event, callback){
			var i;

			if(typeof callback === 'function'){
				event = ('' + event).toLowerCase().split(/\s+/);

				for(i = 0; i < event.length; i++){
					if(this.listeners[event[i]] === void(0)){
						this.listeners[event[i]] = [];
					}
					this.listeners[event[i]].push(callback);
				}
			}
			return this;
		},

		trigger: function(event, target){
			event = event.toLowerCase();
			var	handlers = this.listeners[event] || [],
				i;

			if(handlers.length){
				event = jQuery.Event(event);
				for(i = 0; i < handlers.length; i++){
					try{
						if(handlers[i](event, target) === false || event.isDefaultPrevented()){
							break;
						}
					}catch(ex){
						window.console && window.console.log && window.console.log(ex);
					}
				}
			}
			return this;
		}
	};

	Observer.makeObserver = function(object){
		var i;

		for(i in Observer.prototype){
			if(Observer.prototype.hasOwnProperty(i) && typeof Observer.prototype[i] === "function"){
				object[i] = Observer.prototype[i];
			}
		}
		object.listeners = {};
	};

	return Observer;
}());


ZABBIX.namespace('apps.map');
ZABBIX.apps.map = (function(){
	"use strict";

	// dependencies
	var Observer = ZABBIX.classes.Observer;

	function createMap(containerid, mapdata){

		var CMap = function(containerid, mapdata){
			var selementid,
				linkid,
				setContainer;

			this.reupdateImage = false; // if image should be updated again after last update is finished
			this.imageUpdating = false; // if ajax request for image updating is processing
			this.selements = {}; // element objects
			this.links = {}; // map links array
			this.selection = {
				count: 0, // number of selected elements
				selements: {} // selected elements { elementid: elementid, ... }
			};
			this.currentLinkId = '0'; // linkid of currently edited link

			this.allLinkTriggerIds = {};


			this.sysmapid = mapdata.sysmap.sysmapid;
			this.data = mapdata.sysmap;
			this.iconList = mapdata.iconList;

			this.container = jQuery('#' + containerid);
			if(this.container.length === 0){
				this.container = jQuery(document.body);
			}
			this.container.css({
				width: this.data.width + 'px',
				height: this.data.height + 'px'
			});

			if(IE){
				this.container.css({
					'background-color': 'blue',
					filter: 'alpha(opacity=0)'
				});
			}

			if(IE || GK){
				this.base64image = false;
				this.mapimg = jQuery('#sysmap_img');

				this.container.css('position', 'absolute');

				// resize div on window resize
				setContainer = function(){
					var sysmap_pn = this.mapimg.position(),
						sysmapHeight = this.mapimg.height(),
						sysmapWidth = this.mapimg.width(),
						container_pn = this.container.position();

					if((container_pn.top !== sysmap_pn.top) || (container_pn.left !== sysmap_pn.left) || (this.container.height() !== sysmapHeight) || (this.container.width() !== sysmapWidth)){
						this.container.css({
							top: sysmap_pn.top + 'px',
							left: sysmap_pn.left + 'px',
							height: sysmapHeight + 'px',
							width: sysmapWidth + 'px'
						});
					}
				};
				jQuery(window).resize(jQuery.proxy(setContainer, this));
				this.mapimg.load(jQuery.proxy(setContainer, this));
			}
			else{
				this.container.css('position', 'relative');
				this.base64image = true;
				jQuery('#sysmap_img').remove();
			}


			for(selementid in this.data.selements){
				this.selements[selementid] = new Selement(this, this.data.selements[selementid]);
			}
			for(linkid in this.data.links){
				this.links[linkid] = new Link(this, this.data.links[linkid]);
			}

			// create container for forms
			this.formContainer = jQuery('<div></div>', {id: 'divSelementForm'})
				.css({
					zIndex: 100,
					position: 'absolute',
					top: '50px',
					left: '500px'
				})
				.appendTo('body')
				.draggable({
					containment: [0,0,3200,3200]
				});


			this.updateImage();
			this.form = new SelementForm(this.formContainer, this);
			this.massForm = new MassForm(this.formContainer, this);
			this.linkForm = new LinkForm(this.formContainer, this);
			this.bindActions();

			// initialize SELECTABLE
			this.container.selectable({
				start: jQuery.proxy(function(event){
					if(!event.ctrlKey){
						this.clearSelection();
					}
				}, this),
				stop: jQuery.proxy(function(event){
					var selected = jQuery('.ui-selected', this.container),
						ids = [],
						i,
						ln;

					for(i = 0, ln = selected.length; i < ln; i++){
						ids.push(jQuery(selected[i]).data('id'));

						// remove ui-selected class, to not confuse next selection
						selected.removeClass('ui-selected');
					}
					this.selectElements(ids, event.ctrlKey);
				}, this)
			});
		};
		CMap.prototype = {
			save: function(){
				var url = new Curl(location.href);
				jQuery.ajax({
					url: url.getPath() + '?output=ajax' + '&sid=' + url.getArgument('sid'),
					type: "post",
					data: {
						favobj: "sysmap",
						action: "save",
						sysmapid: this.sysmapid,
						sysmap: Object.toJSON(this.data) // TODO: remove prototype method
					},
					error: function(){
						throw new Error('Cannot save map.');
					}
				});
			},

			updateImage: function(){
				var url = new Curl(),
					urlText = 'map.php' + '?sid=' + url.getArgument('sid'),
					ajaxRequest;

				// is image is updating, set reupdate flag and exit
				if(this.imageUpdating === true){
					this.reupdateImage = true;
					return;
				}

				// grid
				if(this.data.grid_show === '1'){
					urlText += '&grid=' + this.data.grid_size;
				}

				this.imageUpdating = true;
				ajaxRequest = jQuery.ajax({
					url: urlText,
					type: 'post',
					data: {
						output: 'json',
						sysmapid: this.sysmapid,
						noselements: 1,
						nolinks: 1,
						nocalculations: 1,
						selements: Object.toJSON(this.data.selements),
						links: Object.toJSON(this.data.links),
						base64image: (this.base64image ? 1 : 0)
					},
					success: jQuery.proxy(function(data){
						if(this.base64image){
							this.container.css({
								'background-image': 'url("data:image/png;base64,'+data.result+'")',
								width: this.data.width + 'px',
								height: this.data.height + 'px'
							});
						}
						else{
							this.mapimg.attr('src', 'imgstore.php?imageid=' + data.result);
						}

						this.imageUpdating = false;
					}, this),
					error: function(jqXHR, textStatus, errorThrown){
						window.console && window.console.log && window.console.log(jqXHR, textStatus, errorThrown);
						alert('Map image update failed');
					}
				});


				jQuery.when(ajaxRequest).always(function(){
					if(this.reupdateImage === true){
						this.reupdateImage = false;
						this.updateImage();
					}
				})
			},

			// ---------- ELEMENTS ------------------------------------------------------------------------------------
			deleteSelectedElements: function(){
				var selementid;

				if(confirm(locale['S_DELETE_SELECTED_ELEMENTS_Q'])){
					for(selementid in this.selection.selements){
						this.selements[selementid].remove();
						this.removeLinksBySelementId(selementid);
					}

					this.toggleForm();
					this.updateImage();
				}
			},

			// CONNECTORS
			removeLinks: function(){
				var selementid1 = null,
					selementid2 = null,
					selementid,
					linkids,
					i,
					ln;

				if(this.selection.count !== 2){
					alert(locale['S_PLEASE_SELECT_TWO_ELEMENTS']);
					return false;
				}

				for(selementid in this.selection.selements){
					if(selementid1 === null){
						selementid1 = selementid;
					}
					else{
						selementid2 = selementid;
					}
				}

				linkids = this.getLinksBySelementIds(selementid1, selementid2);
				if(linkids.length === 0){
					return false;
				}


				if(confirm(locale['S_DELETE_LINKS_BETWEEN_SELECTED_ELEMENTS_Q'])){
					for(i = 0, ln = linkids.length; i < ln; i++){
						this.links[linkids[i]].remove();
					}

					this.linkForm.hide();
					this.updateImage();
				}
			},

			removeLinksBySelementId: function(selementid){
				var linkids = this.getLinksBySelementIds(selementid),
					i,
					ln;

				for(i = 0, ln = linkids.length; i < ln; i++){
					this.links[linkids[i]].remove();
				}
			},

			getLinksBySelementIds: function(selementid1, selementid2){
				var links = [],
					linkid;

				if(typeof(selementid2) === 'undefined'){
					selementid2 = null;
				}


				for(linkid in this.data.links){
					if(selementid2 === null){
						if((this.data.links[linkid].selementid1 === selementid1) || (this.data.links[linkid].selementid2 === selementid1)){
							links.push(linkid);
						}
					}
					else{
						if((this.data.links[linkid].selementid1 === selementid1) && (this.data.links[linkid].selementid2 === selementid2)){
							links.push(linkid);
						}
						else if((this.data.links[linkid].selementid1 === selementid2) && (this.data.links[linkid].selementid2 === selementid1)){
							links.push(linkid);
						}
					}
				}

				return links;
			},

			//--------------------------------------------------------------------------------

			bindActions: function(){
				var that = this;

				// MAP PANEL EVENTS
				// change grid size
				jQuery('#gridsize').change(function(){
					var value = jQuery(this).val();
					if(that.data.grid_size !== value){
						that.data.grid_size = value;
						that.updateImage();
					}
				});

				// toggle autoalign
				jQuery('#gridautoalign').click(function(){
					that.data.grid_align = that.data.grid_align === '1' ? '0' : '1';
					jQuery(this).html(that.data.grid_align === '1' ? locale['S_ON'] : locale['S_OFF']);
				});

				// toggle grid visibility
				jQuery('#gridshow').click(function(){
					that.data.grid_show = that.data.grid_show === '1' ? '0' : '1';
					jQuery(this).html(that.data.grid_show === '1' ? locale['S_SHOWN'] : locale['S_HIDDEN']);
					that.updateImage();
				});

				// perform align all
				jQuery('#gridalignall').click(function(){
					var selementid;
					for(selementid in that.selements){
						that.selements[selementid].align(true);
					}
					that.updateImage();
				});

				// save map
				jQuery('#sysmap_save').click(function(){
					that.save();
				});

				// add element
				jQuery('#selementAdd').click(function(){
					if(this.iconList.length === 0){
						alert(locale['S_NO_IMAGES']);
						return;
					}
					var selement = new Selement(that);
					that.selements[selement.id] = selement;
					that.updateImage();
				});

				// remove element
				jQuery('#selementRemove').click(function(){
					that.deleteSelectedElements();
				});

				// add link
				jQuery('#linkAdd').click(function(){
					var link;

					if(that.selection.count !== 2){
						alert(locale['S_TWO_ELEMENTS_SHOULD_BE_SELECTED']);
						return false;
					}
					link = new Link(that);
					that.links[link.id] = link;
					that.updateImage();
				});

				// remove link
				jQuery('#linkRemove').click(function(){
					that.removeLinks();
				});


				// SELEMENTS EVENTS
				// delegate selements icons clicks
				jQuery(this.container).delegate('.sysmap_element', 'click', function(event){
					that.selectElements([jQuery(this).data('id')], event.ctrlKey);
				});


				// FORM EVENTS
				// when change elementType, we clear elementnames and elementid
				jQuery('#elementType').change(function(){
					jQuery('input[name=elementName]').val('');
					jQuery('#elementid').val('0');
				});

				jQuery('#elementClose').click(function(){
					that.clearSelection();
					that.toggleForm();
				});
				jQuery('#elementRemove').click(jQuery.proxy(this.deleteSelectedElements, this));
				jQuery('#elementApply').click(jQuery.proxy(function(){
					if(this.selection.count !== 1) throw 'Try to single update element, when more than one selected.';
					var values = this.form.getValues();
					if(values){
						for(var selementid in this.selection.selements){
							this.selements[selementid].update(values, true);
						}
					}

				}, this));
				jQuery('#newSelementUrl').click(jQuery.proxy(function(){
					this.form.addUrls();
				}, this));


				// mass update form
				jQuery('#massClose').click(function(){
					that.clearSelection();
					that.toggleForm();
				});
				jQuery('#massRemove').click(jQuery.proxy(this.deleteSelectedElements, this));
				jQuery('#massApply').click(jQuery.proxy(function(){
					var values = this.massForm.getValues();
					if(values){
						for(var selementid in this.selection.selements){
							this.selements[selementid].update(values);
						}
					}
				}, this));

				// open link form
				jQuery('#linksList').delegate('.openlink', 'click', function(){
					that.currentLinkId = jQuery(this).data('linkid');
					var linkData = that.links[that.currentLinkId].getData();
					that.linkForm.setValues(linkData);
					that.linkForm.show();
				});

				// link form
				jQuery('#formLinkRemove').click(function(){
					that.links[that.currentLinkId].remove();
					for(var selementid in that.selection.selements){
						that.form.updateList(selementid);
					}
					that.linkForm.hide();
					that.updateImage();
				});
				jQuery('#formLinkApply').click(function(){
					var linkData = that.linkForm.getValues();
					that.links[that.currentLinkId].update(linkData)
				});
				jQuery('#formLinkClose').click(function(){
					that.linkForm.hide();
				});

				this.linkForm.domNode.delegate('.triggerRemove', 'click', function(){
					var triggerid,
						tid = jQuery(this).data('linktriggerid').toString();

					jQuery('#linktrigger_'+tid).remove();
					for(triggerid in that.linkForm.triggerids){

						if(that.linkForm.triggerids[triggerid] === tid){
							delete that.linkForm.triggerids[triggerid];
						}
					}
				});

				// changes for color inputs
				this.linkForm.domNode.delegate('.colorpicker', 'change', function(){
					var id = jQuery(this).attr('id');
					set_color_by_name(id, this.value);
				});
				this.linkForm.domNode.delegate('.colorpickerLabel', 'click', function(){
					var id = jQuery(this).attr('id');
					var input = id.match(/^lbl_(.+)$/);
					show_color_picker(input[1]);
				});

			},

			clearSelection: function(){
				var id;

				for(id in this.selection.selements){
					this.selection.count--;
					this.selements[id].toggleSelect(false);
					delete this.selection.selements[id];
				}
			},

			selectElements: function(ids, addSelection){
				var i,
					ln;

				if(!addSelection){
					this.clearSelection();
				}

				for(i = 0, ln = ids.length; i < ln; i++){
					var selementid = ids[i];
					var selected = this.selements[selementid].toggleSelect();
					if(selected){
						this.selection.count++;
						this.selection.selements[selementid] = selementid;
					}
					else{
						this.selection.count--;
						delete this.selection.selements[selementid];
					}
				}

				this.toggleForm();
			},

			toggleForm: function(){
				var selementid;

				this.linkForm.hide();
				if(this.selection.count == 0){
					this.form.hide();
					this.massForm.hide();
				}
				else if(this.selection.count == 1){
					for(selementid in this.selection.selements){
						this.form.setValues(this.selements[selementid].getData());
					}
					this.massForm.hide();
					this.form.show();
				}
				else{
					this.form.hide();
					this.massForm.show();
				}
			}
		};


		/**
		 * Creates a new Link
		 * @class represents connector between two Elements
		 * @property {Object} sysmap reference to Map object
		 * @property {Object} data link db values
		 * @property {String} id linkid
		 *
		 * @param {Object} sysmap Map object
		 * @param {Object} [linkData] link data from db
		 */
		function Link(sysmap, linkData){
			var linkid,
				selementid,
				lnktrigger;

			this.sysmap = sysmap;


			if(!linkData){
				linkData = {
					label:			'',
					selementid1:	null,
					selementid2:	null,
					linktriggers:	{},
					drawtype:		0,
					color:			'00CC00'
				};

				for(selementid in this.sysmap.selection.selements){
					if(linkData.selementid1 === null)
						linkData.selementid1 = selementid;
					else
						linkData.selementid2 = selementid;
				}

				// generate unique linkid
				do{
					linkid = Math.floor(Math.random() * 10000000).toString();
				} while(typeof this.sysmap.data.links[linkid] !== 'undefined');
				linkData.linkid = linkid;
			}
			else{
				if(jQuery.isArray(linkData.linktriggers)){
					linkData.linktriggers = {};
				}
			}

			this.data = linkData;
			this.id = this.data.linkid;

			for(lnktrigger in this.data.linktriggers){
				this.sysmap.allLinkTriggerIds[lnktrigger.triggerid] = true;
			}

			// assign by reference
			this.sysmap.data.links[this.id] = this.data;
		}
		Link.prototype = {
			/**
			 * Updades values in property data
			 * @param {Object} data
			 */
			update: function(data){
				var key;

				for(key in data){
					this.data[key] = data[key];
				}

				this.trigger('afterUpdate', this);
			},

			/**
			 * Removes Link object, delete all reference to it
			 */
			remove: function(){
				delete this.sysmap.data.links[this.id];
				delete this.sysmap.links[this.id];

				this.trigger('afterRemove', this);
			},

			/**
			 * Gets Link data
			 * @returns {Object}
			 */
			getData: function(){
				return this.data;
			}
		};
		Observer.makeObserver(Link.prototype);


		/**
		 * @class Creates a new Selement
		 * @property {Object} sysmap reference to Map object
		 * @property {Object} data selement db values
		 * @property {Boolean} selected if element is now selected by user
		 * @property {String} elementName name of related element (for example trigger description)
		 * @property {String} id elementid
		 * @property {Object} domNode reference to related DOM element
		 *
		 * @param {Object} sysmap reference to Map object
		 * @param {Object} selementData element db values
		 */
		function Selement(sysmap, selementData){
			var selementid;

			this.sysmap = sysmap;
			this.selected = false;


			if(!selementData){
				selementData = {
					elementtype: '4', // image
					elementid: 0,
					iconid_off: this.sysmap.iconList[0].imageid, // first imageid
					label: locale['S_NEW_ELEMENT'],
					label_location: this.sysmap.data.label_location, // set default map label location
					x: 0,
					y: 0,
					urls: {},
					elementName: this.sysmap.iconList[0].name, // image name
					image: this.sysmap.iconList[0].imageid
				};

				// generate unique selementid
				do{
					selementid = Math.floor(Math.random() * 10000000).toString();
				} while(typeof this.sysmap.data.selements[selementid] !== 'undefined');
				selementData.selementid = selementid;
			}
			else{
				if(jQuery.isArray(selementData.urls)){
					selementData.urls = {};
				}
			}

			this.elementName = selementData.elementName;
			delete selementData.elementName;

			this.data = selementData;

			this.id = this.data.selementid;
			// assign by reference
			this.sysmap.data.selements[this.id] = this.data;


			// create dom
			this.domNode = jQuery('<div></div>')
				.appendTo(this.sysmap.container)
				.addClass('pointer sysmap_element')
				.data('id', this.id);


			this.domNode.draggable({
				containment: 'parent',
				opacity: 0.5,
				helper: 'clone',
				stop: jQuery.proxy(function(event, data){
					this.update({
						x: parseInt(data.position.left, 10),
						y: parseInt(data.position.top, 10)
					});
				}, this)
			});

			this.updateIcon();
			this.align();
		}
		Selement.prototype = {
			getData: function(){
				return jQuery.extend({}, this.data, { elementName: this.elementName });
			},

			update: function(data, unsetUndefined){

				var	fieldName,
					dataFelds = [
						'elementtype', 'elementid', 'iconid_off', 'iconid_on', 'iconid_maintenance',
						'iconid_disabled', 'label', 'label_location', 'x', 'y', 'elementsubtype',  'areatype', 'width',
						'height', 'viewtype', 'urls'
					],
					i,
					ln;

				unsetUndefined = unsetUndefined || false;

				// elementName
				if(typeof data.elementName !== 'undefined'){
					this.elementName = data.elementName;
				}

				for(i = 0, ln = dataFelds.length; i < ln; i++){
					fieldName = dataFelds[i];
					if(typeof data[fieldName] !== 'undefined'){
						this.data[fieldName] = data[fieldName];
					}
					else if(unsetUndefined){
						delete this.data[fieldName];
					}
				}

				// if we update all data and advanced_icons turned off or element is image, reset advanced iconids
				if((unsetUndefined && (typeof data.advanced_icons === 'undefined')) || this.data.elementtype === '4'){
					this.data.iconid_on = '0';
					this.data.iconid_maintenance = '0';
					this.data.iconid_disabled = '0';
				}

				// if image element, set elementName to image name
				if(this.data.elementtype === '4'){
					for(i = 0, ln = this.sysmap.iconList.length; i < ln; i++){
						if(this.sysmap.iconList[i].imageid === this.data.iconid_off){
							this.elementName = this.sysmap.iconList[i].name;
						}
					}
				}

				this.updateIcon();
				this.align();
				this.trigger('afterMove', this);

				this.sysmap.updateImage();
			},

			remove: function(){
				this.domNode.remove();
				delete this.sysmap.data.selements[this.id];
				delete this.sysmap.selements[this.id];

				if(typeof this.sysmap.selection.selements[this.id] !== 'undefined')
					this.sysmap.selection.count--;
				delete this.sysmap.selection.selements[this.id];
			},

			toggleSelect: function(state){
				state = state || !this.selected;

				this.selected = state;
				if(this.selected)
					this.domNode.addClass('selected');
				else
					this.domNode.removeClass('selected');

				return this.selected;
			},

			align: function(force){
				var dims = {
					height: this.domNode.height(),
					width: this.domNode.width()
				},
					x = parseInt(this.data.x, 10),
					y = parseInt(this.data.y, 10),
					shiftX = Math.round(dims.width / 2),
					shiftY = Math.round(dims.height / 2),
					newX,
					newY,
					gridSize = parseInt(this.sysmap.data.grid_size, 10);

				force = force || false;


				if((!force && (this.sysmap.data.grid_align == '0')) || ((this.data.elementsubtype === '1') && (this.data.areatype === '0'))){
					if((x + dims.width) > this.sysmap.data.width){
						this.data.x = this.sysmap.data.width - dims.width;
					}
					if((y + dims.height) > this.sysmap.data.height){
						this.data.y = this.sysmap.data.height - dims.height;
					}
				}
				else{
					newX = x + shiftX;
					newY = y + shiftY;

					newX = Math.floor(newX / gridSize) * gridSize;
					newY = Math.floor(newY / gridSize) * gridSize;

					newX += Math.round(gridSize / 2) - shiftX;
					newY += Math.round(gridSize / 2) - shiftY;

					while((newX + dims.width) > this.sysmap.data.width){
						newX -= gridSize;
					}
					while((newY + dims.height) > this.sysmap.data.height){
						newY -= gridSize;
					}

					while(newX < 0){
						newX += gridSize;
					}
					while(newY < 0){
						newY += gridSize;
					}


					this.data.y = newY;
					this.data.x = newX;
				}

				this.domNode.css({
					top: this.data.y + 'px',
					left: this.data.x + 'px'
				});
			},

			updateIcon: function(){
				var oldIconClass = this.domNode.get(0).className.match(/sysmap_iconid_\d+/);

				if(oldIconClass !== null){
					this.domNode.removeClass(oldIconClass[0]);
				}

				this.domNode.addClass('sysmap_iconid_'+this.data.iconid_off);

				if((this.data.elementtype === '3') && (this.data.elementsubtype === '1')){
					if(this.data.areatype === '1'){
						this.domNode
							.css({
							width: this.data.width + 'px',
							height: this.data.height + 'px'
						})
							.addClass('selementArea');
					}
					else{
						this.domNode
							.css({
							width: this.sysmap.data.width + 'px',
							height: this.sysmap.data.height + 'px'
						})
							.addClass('selementArea');
					}

				}
				else{
					this.domNode
						.css({
						width: '',
						height: ''
					})
						.removeClass('selementArea');
				}
			}
		};
		Observer.makeObserver(Selement.prototype);


		function SelementForm(formContainer, sysmap){
			var formTplData = {
					sysmapid: sysmap.sysmapid
				},
				tpl = new Template(jQuery('#mapElementFormTpl').html()),
				i,
				icon,
				formActions = [
					{
						action: 'show',
						value: '#subtypeRow, #hostGroupSelectRow',
						cond: {
							elementType: '3'
						}
					},
					{
						action: 'show',
						value: '#hostSelectRow',
						cond: {
							elementType: '0'
						}
					},
					{
						action: 'show',
						value: '#triggerSelectRow',
						cond: {
							elementType: '2'
						}
					},
					{
						action: 'show',
						value: '#mapSelectRow',
						cond: {
							elementType: '1'
						}
					},
					{
						action: 'show',
						value: '#areaTypeRow, #areaPlacingRow',
						cond: {
							elementType: '3',
							subtypeHostGroupElements: 'checked'
						}
					},
					{
						action: 'show',
						value: '#areaSizeRow',
						cond: {
							elementType: '3',
							subtypeHostGroupElements: 'checked',
							areaTypeCustom: 'checked'
						}
					},
					{
						action: 'show',
						value: '#iconProblemRow, #iconMainetnanceRow, #iconDisabledRow',
						cond: {
							advanced_icons: 'checked'
						}
					},
					{
						action: 'hide',
						value: '#advancedIconsRow',
						cond: {
							elementType: '4'
						}
					}
				];


			this.active = false;
			this.sysmap = sysmap;
			this.formContainer = formContainer;

			// create form
			this.domNode = jQuery(tpl.evaluate(formTplData)).appendTo(formContainer);

			// populate icons selects
			for(i in this.sysmap.iconList){
				icon = this.sysmap.iconList[i];
				jQuery('#iconid_off, #iconid_on, #iconid_maintenance, #iconid_disabled')
					.append('<option value="' + icon.imageid + '">' + icon.name + '</option>');
			}
			jQuery('#iconid_on, #iconid_maintenance, #iconid_disabled')
				.prepend('<option value="0">' + locale['S_DEFAULT'] + '</option>');

			// apply jQuery UI elements
			jQuery('#elementApply, #elementRemove, #elementClose').button();


			this.actionProcessor = new ActionProcessor(formActions);
			this.actionProcessor.process();
		}
		SelementForm.prototype = {
			show: function(){
				this.formContainer.draggable("option", "handle", '#formDragHandler');
				this.domNode.toggle(true);
				this.active = true;
			},

			hide: function(){
				this.domNode.toggle(false);
				this.active = false;
			},

			addUrls: function(urls){
				var tpl = new Template(jQuery('#selementFormUrls').html()),
					i,
					url;

				if((typeof urls === 'undefined') || jQuery.isEmptyObject(urls)){
					urls = {empty: {}};
				}

				for(i in urls){
					url = urls[i];

					// generate unique urlid
					url.selementurlid = jQuery('#urlContainer tr[id^=urlrow]').length;
					while(jQuery('#urlrow_'+url.selementurlid).length){
						url.selementurlid++;
					}

					jQuery(tpl.evaluate(url)).appendTo('#urlContainer');
				}
			},

			setValues: function(selement){
				var elementName;

				for(elementName in selement){
//				jQuery('[name='+elementName+']', this.domNode).val(selement[elementName]);
					jQuery('[name='+elementName+']', this.domNode).val([selement[elementName]]);
				}

				jQuery('#advanced_icons').attr('checked', (selement.iconid_on != 0) || (selement.iconid_maintenance != 0) || (selement.iconid_disabled != 0));

				// clear urls
				jQuery('#urlContainer tr').remove();
				this.addUrls(selement.urls);

				this.actionProcessor.process();

				this.updateList(selement.selementid);
			},

			getValues: function(){
				var values = jQuery('#selementForm').serializeArray(),
					data = {
						urls: {}
					},
					i,
					urlPattern = /^url_(\d+)_(name|url)$/,
					url,
					urlNames = {};

				for(i = 0; i < values.length; i++){
					url = urlPattern.exec(values[i].name);
					if(url !== null){
						if(typeof data.urls[url[1]] === 'undefined'){
							data.urls[url[1]] = {};
						}
						data.urls[url[1]][url[2]] = values[i].value.toString();
					}
					else{
						data[values[i].name] = values[i].value.toString();
					}
				}


				for(i in data.urls){
					if((data.urls[i].name === '') && (data.urls[i].url === '')){
						delete data.urls[i];
						continue;
					}

					if((data.urls[i].name === '') || (data.urls[i].url === '')){
						alert(locale['S_INCORRECT_ELEMENT_MAP_LINK']);
						return false;
					}

					if(typeof urlNames[data.urls[i].name] !== 'undefined'){
						alert(locale['S_EACH_URL_SHOULD_HAVE_UNIQUE'] + " '" + data.urls[i].name + "'.");
						return false;
					}
					urlNames[data.urls[i].name] = 1;
				}


				if((data.elementid === '0') && (data.elementtype !== '4')){
					switch(data.elementtype){
						case '0': alert('Host is not selected.');
							return false;
						case '1': alert('Map is not selected.');
							return false;
						case '2': alert('Trigger is not selected.');
							return false;
						case '3': alert('Host group is not selected.');
							return false;
					}
				}

				data.x = Math.abs(parseInt(data.x, 10));
				data.y = Math.abs(parseInt(data.y, 10));

				return data;
			},

			updateList: function(selementid){
				var links = this.sysmap.getLinksBySelementIds(selementid),
					rowTpl,
					list,
					i,
					ln,
					link,
					linkedSelementid,
					element,
					elementTypeText,
					linktrigger,
					linktriggers;

				if(links.length){
					jQuery('#mapLinksContainer').toggle(true);
					jQuery('#linksList').empty();

					rowTpl = new Template(jQuery('#mapLinksRow').html());

					list = new Array();
					for(i = 0, ln = links.length; i < ln; i++){
						link = this.sysmap.links[links[i]].data;

						linkedSelementid = (selementid == link.selementid1) ? link.selementid2 : link.selementid1;
						element = this.sysmap.selements[linkedSelementid];

						elementTypeText = '';
						switch(element.data.elementtype){
							case '0': elementTypeText = locale['S_HOST']; break;
							case '1': elementTypeText = locale['S_MAP']; break;
							case '2': elementTypeText = locale['S_TRIGGER']; break;
							case '3': elementTypeText = locale['S_HOST_GROUP']; break;
							case '4': elementTypeText = locale['S_IMAGE']; break;
						}

						linktriggers = [];
						for(linktrigger in link.linktriggers){
							linktriggers.push(link.linktriggers[linktrigger].desc_exp);
						}

						list.push({
							elementType: elementTypeText,
							elementName: element.elementName,
							linkid: link.linkid,
							linktriggers: linktriggers.join('\n')
						});
					}

					// sort by elementtype and then by element name
					list.sort(function(a, b){
						if(a.elementType < b.elementType){ return -1; }
						if(a.elementType > b.elementType){ return 1; }
						if(a.elementType == b.elementType){
							var elementTypeA = a.elementName.toLowerCase();
							var elementTypeB = b.elementName.toLowerCase();

							if(elementTypeA < elementTypeB){ return -1; }
							if(elementTypeA > elementTypeB){ return 1; }
						}
						return 0;
					});
					for(i = 0, ln = list.length; i < ln; i++){
						jQuery(rowTpl.evaluate(list[i])).appendTo('#linksList');
					}

					jQuery('#linksList tr:nth-child(odd)').addClass('odd_row');
					jQuery('#linksList tr:nth-child(even)').addClass('even_row');
				}
				else{
					jQuery('#mapLinksContainer').toggle(false);
				}
			}
		};

		function MassForm(formContainer, sysmap){
			var i,
				icon,
				formActions = [
					{
						action: 'enable',
						value: '#massLabel',
						cond: {
							chkboxLabel: 'checked'
						}
					},
					{
						action: 'enable',
						value: '#massLabelLocation',
						cond: {
							chkboxLabelLocation: 'checked'
						}
					},
					{
						action: 'enable',
						value: '#massIconidOff',
						cond: {
							chkboxMassIconidOff: 'checked'
						}
					},
					{
						action: 'enable',
						value: '#massIconidOn',
						cond: {
							chkboxMassIconidOn: 'checked'
						}
					},
					{
						action: 'enable',
						value: '#massIconidMaintenance',
						cond: {
							chkboxMassIconidMaintenance: 'checked'
						}
					},
					{
						action: 'enable',
						value: '#massIconidDisabled',
						cond: {
							chkboxMassIconidDisabled: 'checked'
						}
					}
				];

			this.sysmap = sysmap;
			this.formContainer = formContainer;

			// create form
			var tpl = new Template(jQuery('#mapMassFormTpl').html());
			this.domNode = jQuery(tpl.evaluate()).appendTo(formContainer);


			// populate icons selects
			for(i in this.sysmap.iconList){
				icon = this.sysmap.iconList[i];
				jQuery('#massIconidOff, #massIconidOn, #massIconidMaintenance, #massIconidDisabled')
					.append('<option value="' + icon.imageid + '">' + icon.name + '</option>');
			}
			jQuery('#massIconidOn, #massIconidMaintenance, #massIconidDisabled')
				.prepend('<option value="0">' + locale['S_DEFAULT'] + '</option>');

			// apply jQuery UI elements
			jQuery('#massApply, #massRemove, #massClose').button();

			this.actionProcessor = new ActionProcessor(formActions);
			this.actionProcessor.process();
		}
		MassForm.prototype = {
			show: function(){
				this.formContainer.draggable("option", "handle", '#massDragHandler');
				jQuery('#massElementCount').text(this.sysmap.selection.count);
				this.domNode.toggle(true);

				this.updateList();
			},

			hide: function(){
				this.domNode.toggle(false);
				jQuery(':checkbox', this.domNode).prop('checked', false);
				jQuery('select', this.domNode).each(function(){
					var select = jQuery(this);
					select.val(jQuery('option:first', select).val());
				});
				jQuery('textarea', this.domNode).val('');
				this.actionProcessor.process();
			},

			getValues: function(){
				var values = jQuery('#massForm').serializeArray(),
					data = {},
					i,
					ln;

				for(i = 0, ln = values.length; i < ln; i++){
					if(values[i].name.match(/^chkbox_/) !== null) continue;

					data[values[i].name] = values[i].value.toString();
				}

				return data;
			},

			updateList: function(){
				var tpl = new Template(jQuery('#mapMassFormListRow').html()),
					id,
					list = [],
					element,
					elementTypeText,
					i,
					ln;

				jQuery('#massList').empty();
				for(id in this.sysmap.selection.selements){
					element = this.sysmap.selements[id];

					switch(element.data.elementtype){
						case '0': elementTypeText = locale['S_HOST']; break;
						case '1': elementTypeText = locale['S_MAP']; break;
						case '2': elementTypeText = locale['S_TRIGGER']; break;
						case '3': elementTypeText = locale['S_HOST_GROUP']; break;
						case '4': elementTypeText = locale['S_IMAGE']; break;
					}
					list.push({
						elementType: elementTypeText,
						elementName: element.elementName
					});
				}

				// sort by element type and then by element name
				list.sort(function(a, b){
					var elementTypeA = a.elementType.toLowerCase(),
						elementTypeB = b.elementType.toLowerCase(),
						elementNameA,
						elementNameB;

					if(elementTypeA < elementTypeB){ return -1; }
					if(elementTypeA > elementTypeB){ return 1; }

					elementNameA = a.elementName.toLowerCase();
					elementNameB = b.elementName.toLowerCase();
					if(elementNameA < elementNameB){ return -1; }
					if(elementNameA > elementNameB){ return 1; }

					return 0;
				});
				for(i = 0, ln = list.length; i < ln; i++){
					jQuery(tpl.evaluate(list[i])).appendTo('#massList');
				}

				jQuery('#massList tr:nth-child(odd)').addClass('odd_row');
				jQuery('#massList tr:nth-child(even)').addClass('even_row');
			}
		};

		function LinkForm(formContainer, sysmap){
			this.sysmap = sysmap;
			this.formContainer = formContainer;
			this.triggerids = {};

			this.domNode = jQuery('#linkForm');

			// apply jQuery UI elements
			jQuery('#formLinkApply, #formLinkRemove, #formLinkClose').button();
		}
		LinkForm.prototype = {
			show: function(){
				this.domNode.toggle(true);
				jQuery('#elementApply, #elementRemove').button('disable');
			},

			hide: function(){
				this.domNode.toggle(false);
				jQuery('#elementApply, #elementRemove').button('enable');
			},

			getValues: function(){
				var values = jQuery('#linkForm').serializeArray(),
					data = {
						linktriggers: {}
					},
					i,
					ln,
					linkTriggerPattern = /^linktrigger_(\d+)_(triggerid|linktriggerid|drawtype|color|desc_exp)$/,
					linkTrigger;

				for(i = 0, ln = values.length; i < ln; i++){
					linkTrigger = linkTriggerPattern.exec(values[i].name);
					if(linkTrigger !== null){
						if(typeof data.linktriggers[linkTrigger[1]] === 'undefined'){
							data.linktriggers[linkTrigger[1]] = {};
						}
						data.linktriggers[linkTrigger[1]][linkTrigger[2]] = values[i].value.toString();
					}
					else{
						data[values[i].name] = values[i].value.toString();
					}
				}

				return data;
			},

			setValues: function(link){
				var selement1,
					tmp,
					selementid,
					selement,
					elementName,
					optgroups = {},
					optgroupType,
					optgroupLabel,
					optgroupDom,
					i,
					ln;

				// get currenlty selected element
				for(selementid in this.sysmap.selection.selements){
					selement1 = this.sysmap.selements[selementid];
				}
				// make that selementi1 always equal to selected element and selementid2 to connected
				if(selement1.id !== link.selementid1){
					tmp = link.selementid1;
					link.selementid1 = selement1.id;
					link.selementid2 = tmp;
				}

				// populate list of elements to connect with
				jQuery('#selementid2').empty();

				// sort by type
				for(selementid in this.sysmap.selements){
					selement = this.sysmap.selements[selementid];
					if(selement.id == link.selementid1) continue;

					if(optgroups[selement.data.elementtype] === void(0)){
						optgroups[selement.data.elementtype] = [];
					}
					optgroups[selement.data.elementtype].push(selement);
				}

				for(optgroupType in optgroups){
					switch(optgroupType){
						case '0': optgroupLabel = locale['S_HOST']; break;
						case '1': optgroupLabel = locale['S_MAP']; break;
						case '2': optgroupLabel = locale['S_TRIGGER']; break;
						case '3': optgroupLabel = locale['S_HOST_GROUP']; break;
						case '4': optgroupLabel = locale['S_IMAGE']; break;
					}

					optgroupDom = jQuery('<optgroup label="'+optgroupLabel+'"></optgroup>');
					for(i = 0, ln = optgroups[optgroupType].length; i < ln; i++){
						optgroupDom.append('<option value="' + optgroups[optgroupType][i].id + '">' + optgroups[optgroupType][i].elementName + '</option>')
					}

					jQuery('#selementid2').append(optgroupDom);
				}


				// set values for form elements
				for(elementName in link){
					jQuery('[name='+elementName+']', this.domNode).val(link[elementName]);
				}

				// clear triggers
				this.triggerids = {};
				jQuery('#linkTriggerscontainer tr').remove();
				this.addTriggers(link.linktriggers);
			},

			addTriggers: function(triggers){
				var tpl = new Template(jQuery('#linkTriggerRow').html()),
					linkTrigger;

				for(linkTrigger in triggers){
					this.triggerids[triggers[linkTrigger].triggerid] = linkTrigger;

					jQuery(tpl.evaluate(triggers[linkTrigger])).appendTo('#linkTriggerscontainer');

					jQuery('#linktrigger_'+triggers[linkTrigger].linktriggerid+'_drawtype').val(triggers[linkTrigger].drawtype);
				}
				jQuery('.colorpicker', this.domNode).change();
			},

			addNewTriggers: function(triggers){
				var tpl = new Template(jQuery('#linkTriggerRow').html()),
					linkTrigger = {
						color: 'DD0000'
					},
					linktriggerid,
					i,
					ln;


				for(i = 0, ln = triggers.length; i < ln; i++){
					if(typeof this.triggerids[triggers[i].triggerid] !== 'undefined'){
						continue;
					}

					do{
						linktriggerid = Math.floor(Math.random() * 10000000).toString();
					}while(typeof this.sysmap.allLinkTriggerIds[linktriggerid] !== 'undefined');

					// store linktriggerid to generate every time unique one
					this.sysmap.allLinkTriggerIds[linktriggerid] = true;

					// store triggerid to forbid selecting same trigger twice
					this.triggerids[triggers[i].triggerid] = linktriggerid;

					linkTrigger.linktriggerid = linktriggerid;
					linkTrigger.desc_exp = triggers[i].description;
					linkTrigger.triggerid = triggers[i].triggerid;

					jQuery(tpl.evaluate(linkTrigger)).appendTo('#linkTriggerscontainer');
				}
				jQuery('.colorpicker', this.domNode).change();
			}
		};

		var sysmap = new CMap(containerid, mapdata);

		Selement.prototype.bind('afterMove', function(event, data){
			if((sysmap.selection.count === 1) && (sysmap.selection.selements[data.id]) !== void(0)){
				jQuery('#x').val(data.data.x);
				jQuery('#y').val(data.data.y);
			}
		});

		Link.prototype.bind('afterUpdate', function(){
			sysmap.updateImage();
		});

		Link.prototype.bind('afterRemove', function(){
			if(sysmap.form.active){
				for(var selementid in sysmap.selection.selements){
					sysmap.form.updateList(selementid);
				}
			}

			sysmap.linkForm.hide();
			sysmap.updateImage();
		});

		return sysmap;
	}

	return {
		object: null,
		run: function(containerid, mapdata){
			if(this.object !== null) throw new Error('Map has already been run.');

			this.object = createMap(containerid, mapdata);
		}
	}
}());


/**
 * Function that is executed by popup.php to ass selected values to destination.
 * It uses a sysmap global variable that created in sysmap.php file via 'var sysmap = ZABBIX.apps.map.run();'
 * @param list link triggers selected in popup
 * @param {String} list.object name of objects which we returned
 * @param {Array} list.values list of link triggers
 */
function addPopupValues(list){
	if(list.object === 'linktrigger'){
		ZABBIX.apps.map.object.linkForm.addNewTriggers(list.values);
	}
}
