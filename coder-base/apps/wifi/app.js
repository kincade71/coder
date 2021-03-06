/**
 * Coder for Raspberry Pi
 * A simple platform for experimenting with web stuff.
 * http://goo.gl/coder
 *
 * Copyright 2013 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var mustache = require('mustache');
var util = require('util');
var fs = require('fs');

var sudoscripts = process.cwd() + '/sudo_scripts';

exports.settings={};
//These are dynamically updated by the runtime
//settings.appname - the app id (folder) where your app is installed
//settings.viewpath - prefix to where your view html files are located
//settings.staticurl - base url path to static assets /static/apps/appname
//settings.appurl - base url path to this app /app/appname


exports.get_routes = [
    { path:'/', handler:'index_handler'},
    { path: '/api/wifi/list', handler: 'api_wifi_list_handler' }
];


exports.post_routes = [
    { path: '/api/wifi/configure', handler: 'api_wifi_configure_handler' },
    { path: '/api/reboot', handler: 'api_reboot_handler' }
];

exports.on_destroy = function() {
};

exports.api_wifi_configure_handler = function( req, res ) {
    var ssid = req.param('ssid');
    var type = req.param('type');
    var password = req.param('password');

    if ( typeof ssid === 'undefined' || ssid === '' ||
         typeof type === 'undefined' || type === '' ||
         typeof password === 'undefined' ) {
        res.json({
            'status': 'error',
            'error': 'invalid parameters' 
        });
        return;
    }
    if ( type !== "OPEN" && password === "" ) {
        res.json({
            'status': 'error',
            'error': 'password not set'
        });
    }

    if ( type !== 'OPEN' && type != 'WEP' && password.length < 8 ) {
        res.json({
            'status': 'error',
            'error': 'short password'
        });
    }

    if ( type !== 'WPAPSK' && type != 'WEP' && type != 'OPEN' ) {
        res.json({
            'status': 'error',
            'error': 'unknown type' 
        });
        return;
    }
    var escapestring = function( str ) { 
        return str.replace(/([\\"'])/g, "\\$1").replace(/[\0\r\t\n]/g,"");
    }

    ssid = escapestring(ssid);
    password = escapestring(password);


    var wpatemplate = "network={\n" +
    	"\tssid=\"[ssid]\"\n" +
    	"\tpsk=\"[password]\"\n" +
    	"\tscan_ssid=1\n" +
    	"\tpriority=10\n" +
	"}\n";

    var weptemplate = "network={\n" +
    	"\tssid=\"[ssid]\"\n" +
    	"\twep_key0=\"[password]\"\n" +
    	"\tscan_ssid=1\n" +
    	"\tkey_mgmt=NONE\n" +
    	"\tpriority=10\n" +
	"}\n";

    var opentemplate = "network={\n" +
    	"\tssid=\"[ssid]\"\n" +
    	"\tscan_ssid=1\n" +
    	"\tkey_mgmt=NONE\n" +
    	"\tpriority=10\n" +
	"}\n";


    var confentry="";
    switch ( type ) {
        case "WPAPSK":
            confentry = wpatemplate;
            break;
        case "WEP":
            confentry = weptemplate;
            break;
        case "OPEN":
            confentry = opentemplate;
            break;
    }

    

    confentry = confentry.replace( "[ssid]", ssid );
    confentry = confentry.replace( "[password]", password );
    saveWifiConfigEntry( confentry );

    res.json( { status: "success" } );
    //res.write( confentry );
    //res.end();
};


var wpa_config = "/etc/wpa_supplicant/wpa_supplicant.conf";
var saveWifiConfigEntry = function( configdata ) {

    conffiledata = fs.readFileSync( wpa_config, 'utf8' );
    if ( conffiledata.match(/\n##BEGIN_AUTOGENERATED[\s\S]*\n##END_AUTOGENERATED/) ) {
    
        conffiledata = conffiledata.replace( /\n##BEGIN_AUTOGENERATED[\s\S]*\n##END_AUTOGENERATED/,
                "\n##BEGIN_AUTOGENERATED\n\n" +
                configdata + 
                "\n\n##END_AUTOGENERATED" );

    } else {

        conffiledata += "\n\n##BEGIN_AUTOGENERATED\n\n";
        conffiledata += configdata;
        conffiledata += "\n\n##END_AUTOGENERATED\n";
    }

    var result = fs.writeFileSync( wpa_config, conffiledata, 'utf8' );

    return result;
};


exports.api_reboot_handler = function( req, res ) {
    var spawn = require('child_process').spawn;
    var rebootproc = spawn( '/usr/bin/sudo', [ sudoscripts + '/reboot'] );
    rebootproc.addListener( 'exit', function( code, signal ) {
        res.json( { status: 'success' } );
    });        
};


exports.api_wifi_list_handler = function( req, res ) {
    var spawn = require('child_process').spawn;
    var data = "";

    var scanStep1 = function( ) {
        var scanproc = spawn( '/usr/bin/sudo', [ sudoscripts + '/wpa_cli_apscan'] );
        scanproc.addListener( 'exit', function( code, signal ) {
            scanStep2();
        });        
    };
    var scanStep2 = function( ) {
        var scanproc = spawn( '/usr/bin/sudo', [ sudoscripts + '/wpa_cli_scan'] );
        scanproc.addListener( 'exit', function( code, signal ) {
            scanStep3();
        });        
    };
    var scanStep3 = function( ) {
        var scanproc = spawn( '/usr/bin/sudo', [ sudoscripts + '/wpa_cli_scanresults'] );
        scanproc.stdout.on( 'data', function(d) { data += d; } );        
        scanproc.addListener( 'exit', function( code, signal ) {
            returnData();
        });
    };
    var returnData = function( ) {
        var lines = data.split('\n');
        var access_points = {};
        var debug="";

	    var addHighestSignal = function( ssid, type, signal ) {
            if ( !access_points[ssid] ) {
                access_points[ssid] = { ssid: ssid, type: type, signal: signal };
            } else if ( access_points[ssid].signal < signal ) {
                access_points[ssid] = { ssid: ssid, type: type, signal: signal };
            }
        }


        for ( var x=0; x<lines.length; x++ ) {
            var line = lines[x];

            // filter out lines that have a base station (as opposed to IBSS for ad-hoc)
            if ( line.match(/\[ESS\]/) ) {
                var parts = line.split('\t');
                // filter out WEP and WPA or WPA2 PSK access points that have a visible SSID
                if ( parts[4] !== "" ) {
                    if ( parts[3].match(/WEP/) ) {
                        addHighestSignal( parts[4], "WEP", parts[2] );
                    } else if ( parts[3].match(/PSK/) ) {
                        addHighestSignal( parts[4], "WPAPSK", parts[2] );
                    } else if ( parts[3] === "[ESS]" ) {
                        addHighestSignal( parts[4], "OPEN", parts[2] );
                    }
                }
            }
        }
        var filtered = [];
        for ( var k in access_points ) {
            filtered[filtered.length] = access_points[k];
        }
        res.json( { networks: filtered } );
    };

    scanStep1();
};

exports.index_handler = function( req, res ) {
    var tmplvars = {};
    tmplvars['static_url'] = exports.settings.staticurl;
    tmplvars['app_name'] = exports.settings.appname;
    tmplvars['app_url'] = exports.settings.appurl;
    tmplvars['device_name'] = exports.settings.device_name;
    tmplvars['page_mode'] = "selectwifi";

    res.render( exports.settings.viewpath + '/index', tmplvars );
};
