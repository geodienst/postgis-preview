(function(){
  'use strict'
  //initialize a leaflet map
  var map = L.map('map')
    .setView([40.708816,-74.008799], 11);
  
  //layer will be where we store the L.geoJSON we'll be drawing on the map
  var querylayer;

  var sql;

  var request;

  //add CartoDB 'dark matter' basemap
  var darkmatter = L.tileLayer('http://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom : 21,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="http://cartodb.com/attributions">CartoDB</a>'
  }).addTo(map);

  var Esri_WorldImagery = L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 21, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });

  var baseMaps = {
    "imagery": Esri_WorldImagery,
    "darkmatter": darkmatter
  };

  // Will contain the results from the query
  var resultLayer = L.featureGroup().addTo(map);


  var overlayMaps = {
    'features': resultLayer
  };


  L.control.layers(baseMaps,overlayMaps).addTo(map);

  var queryHistory = (localStorage.history) ? JSON.parse(localStorage.history) : [];
  var historyIndex = queryHistory.length;
  updateHistoryButtons();

  var abortButton = $('#abort').detach();

  function abortQuery() {
    request.abort();
    $('#query-control').removeClass('active disabled');
    abortButton.detach();
  }

  function submitQuery() {
    $('#notifications').hide();
    $('#download').hide();
    $('#run').addClass('active disabled');
    $('#query-control').append(abortButton);

    clearTable();

    let sql = {
      q: editor.getDoc().getValue()
    };
    
    if ($('#limit-to-count').is(':checked'))
      sql.limit = $('#limit-count').val();

    if ($('#limit-to-view').is(':checked'))
      sql.bbox = map.getBounds().toBBoxString();
  
    addToHistory(sql);

    //clear the map
    resultLayer.clearLayers();

    var url = 'sql.php?' + $.param(sql);

    //pass the query to the sql api endpoint
    request = $.getJSON(url, function(data) {
      // Show any notifications
      $('#notifications').empty().show();

      if (data.error !== undefined){
        //write the error in the sidebar
        $('#notifications').removeClass().addClass('alert alert-danger');
        $('#notifications').text(data.error);
      } else if (data.features.length == 0) {
        $('#notifications').removeClass().addClass('alert alert-warning');
        $('#notifications').text('Your query returned no features.');
      } else {
        var features = data.features;
        var featureCount = data.features.length;
        var geoFeatures = features.filter(function(feature) {
          return feature.geometry;
        });
        $('#notifications').removeClass().addClass('alert alert-success');
        if (geoFeatures.length) {
          addLayer( geoFeatures ); //draw the map layer
          $('#notifications').text(featureCount + ' features returned.');
        } else {
          // There is no map to display, so switch to the data view
          $('#notifications').html(featureCount + ' features returned.<br/>No geometries returned, see the <a href="#" class="data-view">data view</a> for results.');
          //toggle map and data view
          $('a.data-view').click(function(){
            $('#map').hide();
            $('#table').show();
          });

        }
        buildTable( features ); //build the table
      }
    });

    request.done(function() {
      $('#run').removeClass('active disabled');
      abortButton.detach();
    });

    request.done(function() {
      // Show (and update) download buttons
      $('#download').show();
      $('#geojson').attr('href', 'sql.php?q=' + encodeURIComponent(sql) + '&format=geojson');
      $('#csv').attr('href', 'sql.php?q=' + encodeURIComponent(sql) + '&format=csv');
    });

    request.fail(function() {
      $('#run').removeClass('active disabled');
      abortButton.detach();
    });
  };

  //listen for submit of new query
  $('#run').click(submitQuery);

  abortButton.click(abortQuery);

  //toggle map and data view
  $('.btn-group button').click(function(e) {
    $(this).addClass('active').siblings().removeClass('active');

    var view = $(this)[0].innerText;

    if(view == "Data View") {
      $('#map').hide();
      $('#table').show();
    } else {
      $('#map').show();
      $('#table').hide();
    }
  });

  function previousQuery() {
    historyIndex--;
    updateSQL(queryHistory[historyIndex]);
    updateHistoryButtons();
  }

  function nextQuery() {
    historyIndex++;
    updateSQL(queryHistory[historyIndex]);
    updateHistoryButtons();
  }

  //forward and backward buttons for query history
  $('#history-previous').click(previousQuery);

  $('#history-next').click(nextQuery);

  function propertiesTable( properties ) {
    if (!properties) {
      properties = {};
    }

    var table = $('<table class="table table-condensed">\
      <thead>\
        <tr><th>Column</th><th>Value</th></tr>\
      </thead>\
      <tbody></tbody>\
    </table>');

    var keys = Object.keys(properties);
    var tbody = table.find('tbody');
    for (var k = 0; k < keys.length; k++) {
      var row = $("<tr></tr>").appendTo(tbody);
      row.append($("<td></td>").text(keys[k]));
      row.append($("<td></td>").text(properties[keys[k]]));
    }
    return table.get(0);
  }

  function addLayer( features ) {
    //create an L.geoJson layer, add it to the map
    L.geoJson(features, {
      style: {
          color: '#fff', // border color
          fillColor: 'steelblue',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.7
      },

      onEachFeature: function ( feature, layer ) {
        if (feature.geometry.type !== 'Point') {
          layer.bindPopup(propertiesTable(feature.properties));
        }
      },

      pointToLayer: function ( feature, latlng ) {
        return L.circleMarker(latlng, {
          radius: 4,
          fillColor: "#ff7800",
          color: "#000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        }).bindPopup(propertiesTable(feature.properties));
      }
    }).addTo(resultLayer);

    map.fitBounds(resultLayer.getBounds());
  }

  let table = null;

  function buildTable( features ) {
    //assemble a table from the geojson properties

    //first build the header row
    let fields = Object.keys(features[0].properties);

    let columns = fields.map(field => ({
      title: field,
      data: field
    }));

    let data = features.map(feature => feature.properties);

    if (table) clearTable();

    table = $('#table > table').DataTable({
      columns: columns,
      data: data,
      responsive: true
    });
  }

  function clearTable() {
    if (!table)
      return;
    
    table.destroy(true);
    table = null;
    $('<table>')
      .addClass('table table-striped table-bordered')
      .appendTo('#table');
  };

  function addToHistory(sql) {
    //only store the last 25 queries
    while (queryHistory.length > 25) {
      queryHistory.shift();
      historyIndex--;
    }

    queryHistory.push(sql);
    localStorage.history = JSON.stringify(queryHistory);
    historyIndex++;
    updateHistoryButtons();
  }

  function parseBBox(bbox) {
    let parts = bbox.split(',').map(part => parseFloat(part, 10));
    return L.latLngBounds([[parts[1], parts[0]], [parts[3], parts[2]]]);
  }

  function updateSQL(sql) {
    if (typeof sql == 'string') {
      // compatibility with old history
      editor.setValue(sql);
    } else {
      editor.setValue(sql.q);
      $('#limit-to-count').prop('checked', sql.limit);
      $('#limit-to-view').prop('checked', sql.bbox);

      if (sql.limit) {
        $('#limit-count').val(sql.limit);
      }

      if (sql.bbox) {
        map.fitBounds(parseBBox(sql.bbox));
      }
    }
  }

  //enable and disable history buttons based on length of queryHistory and historyIndex
  function updateHistoryButtons() {
    if (historyIndex > queryHistory.length - 2) {
       $('#history-next').addClass('disabled')
     } else {
       $('#history-next').removeClass('disabled')
    }

    if(queryHistory[historyIndex-1]) {
      $('#history-previous').removeClass('disabled')
    } else {
      $('#history-previous').addClass('disabled')
    }
  }

  function resizeable(area) {
    let pos;
    let width;

    let setWidth = function(preferredWidth, store) {
      let width = Math.max(Math.min(preferredWidth, window.innerWidth - 200), 200);
      $(area).width(width);
      map.invalidateSize();
      if (store)
        window.localStorage[name + '_width'] = width;
    }

    area.find('.resize-handle').on('mousedown', function(e) {
      pos = e.clientX;
      width = $(area).width();
      e.preventDefault();
    });

    $(document.body).on('mouseup', function(e) {
      if (pos !== null) {
        pos = null;
        e.preventDefault();
      }
    });

    $(document.body).on('mousemove', function(e) {
      if (pos !== null) {
        setWidth(width - (e.clientX - pos), true);
        e.preventDefault();
      }
    });

    if (window.localStorage[name + '_width'] !== undefined)
      setWidth(window.localStorage[name + '_width']);
  }

  resizeable($('#sidebar'));

  //Load codemirror for syntax highlighting
  window.onload = function() {            
    window.editor = CodeMirror.fromTextArea(document.getElementById('sqlPane'), {
      mode: 'text/x-pgsql',
      indentWithTabs: true,
      smartIndent: true,
      lineNumbers: false,
      matchBrackets : true,
      autofocus: true,
      lineWrapping: true,
      theme: 'monokai'
    });
    editor.setOption("extraKeys", {
      "F5": submitQuery,
      "Cmd-Enter": submitQuery,
      "Alt-Up": previousQuery,
      "Alt-Down": nextQuery,
      "Ctrl-Space": "autocomplete"
    });
    editor.replaceRange('\n', {line:2,ch:0}); // create newline for editing
    editor.setCursor(2,0);

    $.getJSON('schema.php', function(schema) {
      editor.setOption('hintOptions', {tables: schema});
    });
  };
}());