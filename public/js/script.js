(function(){
  'use strict'

  // Numeric column types that the choropleth visualisation can process
  function isNumericType(type) {
    return /^float\d*|int\d*|numeric$/.test(type);
  }

  //initialize a leaflet map
  const map = L.map('map');

  // Try to restore the last map center & zoom
  try {
    map.setView(JSON.parse(localStorage['map_center']), parseFloat(localStorage['map_zoom']));
  } catch (e) {
    map.setView([40.708816,-74.008799], 11);
  }

  // If the map moves or zooms, remember the zoom and center
  // (Could also be done on unload, but this way opening a second tab clones the position of the map!)
  map.on('moveend zoomend', function() {
    localStorage['map_center'] = JSON.stringify(map.getCenter());
    localStorage['map_zoom'] = map.getZoom();
  });

  let editor = null; // Will be initialized onload

  const highlightStyle = {
    fillColor: 'red',
    fillOpacity: 1.0
  };
  
  //layer will be where we store the L.geoJSON we'll be drawing on the map
  var querylayer;

  // Contains the current request promise, which we can then abort() if necessary
  var request;

  //add CartoDB 'dark matter' basemap
  const darkmatter = L.tileLayer('http://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom : 21,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="http://cartodb.com/attributions">CartoDB</a>'
  }).addTo(map);

  const Esri_WorldImagery = L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 21, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });

  const baseMaps = {
    "imagery": Esri_WorldImagery,
    "darkmatter": darkmatter
  };

  // Will contain the results from the query
  const resultLayer = L.featureGroup().addTo(map);

  // Can be drawn on
  const drawLayer = L.featureGroup().addTo(map);

  const overlayMaps = {
    'features': resultLayer,
    'draw': drawLayer
  };

  map.addControl(new L.Control.Draw({
    draw: {
      marker: false,
      polyline: false,
      polygon: {
        allowIntersection: false,
        showArea: true
      }
    },
    edit: {
      featureGroup: drawLayer
    },
  }));

  map.on(L.Draw.Event.CREATED, function (event) {
    drawLayer.addLayer(event.layer);
  });

  // Layer control
  L.control.layers(baseMaps,overlayMaps).addTo(map);

  // History
  var queryHistory = (localStorage.history) ? JSON.parse(localStorage.history) : [];
  var historyIndex = queryHistory.length;
  updateHistoryButtons();

  // Stops the checkbox from toggling when altering the limit (TODO: this is a dirty hack)
  $('#limit-count').click(() => false);

  var abortButton = $('#abort').detach();

  const databaseSelector = $('#database-selector');

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
      db: databaseSelector.val(),
      q: editor.getDoc().getValue()
    };
    
    if ($('#limit-to-count').is(':checked'))
      sql.limit = $('#limit-count').val();

    if ($('#limit-to-view').is(':checked'))
      sql.bbox = map.getBounds().toBBoxString();

    if (drawLayer.getLayers().length)
      sql.shapes = JSON.stringify(drawLayer.toGeoJSON());

    //clear the map
    resultLayer.clearLayers();

    addToHistory(sql);

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
        // Add an id to link this feature in the map and the table
        data.features.forEach((feature, index) => {
          feature.properties._feature_id = index;
        });
        $('#notifications').removeClass().addClass('alert alert-success');
        if (data.features.some(feature => feature.geometry)) {
          // Find out if and how many numeric feature properties there are
          let numericProperties = Object.entries(data._columns).filter(entry => isNumericType(entry[1]));

          //draw the map layer
          if (numericProperties.length === 1)
            addChoroplethLayer(data, numericProperties[0][0]);
          else
            addLayer(data.features.filter(feature => feature.geometry));

          var duration = Math.round(data._timing * 1000);
          $('#notifications').text(data.features.length + ' features returned in ' + duration + 'ms.');
        } else {
          // There is no map to display, so switch to the data view
          $('#notifications').html(data.features.length + ' features returned.<br/>No geometries returned, see the <a href="#" class="data-view">data view</a> for results.');
        }
        buildTable(data.features); //build the table
      }
    });

    request.done(function() {
      $('#run').removeClass('active disabled');
      abortButton.detach();
    });

    request.done(function() {
      // Show (and update) download buttons
      $('#download').show();
      $('#geojson').attr('href', 'sql.php?' + $.param(Object.assign({}, sql, {'format': 'geojson', 'limit': null})));
      $('#csv').attr('href', 'sql.php?' + $.param(Object.assign({}, sql, {'format': 'csv', 'limit': null})));
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
  function switchView(view) {
    $('.view-switches button').toggleClass('active', function() { return $(this).data('view') == view; });
    $('#map, #table').toggle(0, function() { return this.id == view; });
  }

  $('.view-switches button[data-view]').click(function(e) {
    switchView($(this).data('view'));
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

    var keys = Object.keys(properties).filter(key => key != '_feature_id');
    var tbody = table.find('tbody');
    for (var k = 0; k < keys.length; k++) {
      var row = $("<tr></tr>").appendTo(tbody);
      row.append($("<td></td>").text(keys[k]));
      row.append($("<td></td>").text(properties[keys[k]]));
    }
    return table.get(0);
  }

  function addChoroplethLayer(features, property) {
    //create an L.geoJson layer, add it to the map
    L.choropleth(features, {
      valueProperty: property,
      style: {
          color: '#fff', // border color
          weight: 1,
          fillOpacity: 0.7
      },
      scale: ['white', 'red'],
      steps: 10,
      mode: 'q',
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

  $.fn.dataTable.ext.buttons.highlight = {
    extend: 'selected',
    text: 'Highlight on map',
    action: function(e, dt, button, config) {
      let featureIds = dt.rows({selected: true}).ids().toArray().map(id => parseInt(id, 10));
      resultLayer.eachLayer(queryLayer => {
        queryLayer.eachLayer(feature => {
          if (featureIds.includes(feature.feature.properties._feature_id)) {
            feature.setStyle(highlightStyle);
            feature.bringToFront();
          } else {
            queryLayer.resetStyle(feature);
          }
        });
      });
      switchView('map');
    }
  };

  let dataTableLayout = "<'row'<'col-sm-6'l><'col-sm-6 datatable-controls'Bf>>" +
                        "<'row'<'col-sm-12'tr>>" +
                        "<'row'<'col-sm-5'i><'col-sm-7'p>>";

  function buildTable( features ) {
    //assemble a table from the geojson properties

    if (table) clearTable();

    //first build the header row
    let fields = Object.keys(features[0].properties).filter(field => field != '_feature_id');

    // Sometimes we only query geometry, and then the table will be empty
    if (fields.length == 0)
      return;

    let columns = fields.map(field => ({
      title: field,
      data: field
    }));

    let data = features.map(feature => feature.properties);

    table = $('#table > table').DataTable({
      dom: dataTableLayout,
      columns: columns,
      rowId: '_feature_id',
      data: data,
      responsive: true,
      select: true,
      buttons: ['highlight']
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

  $('#sidebar').resizable({
    min: () => 200,
    max: () => window.innerWidth - 200, // Full width minus a bit to at least know there is a map
    inverse: true,
    callback: () => {
      map.invalidateSize();
      if (editor)
        editor.refresh();
    }
  });

  $('#editor').resizable({
    min: () => 200,
    max: () => window.innerHeight - 110, // full widow hight minus RUN button and header bar
    callback: () => {
      if (editor)
        editor.refresh();
    }
  });

  //Load codemirror for syntax highlighting
  window.onload = function() {            
    editor = CodeMirror.fromTextArea(document.getElementById('sqlPane'), {
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

    $.getJSON('config.php', function(config) {
      databaseSelector.empty();

      config.databases.forEach(function(database) {
        console.log(database);
        $('<option>').text(database).appendTo(databaseSelector);
      });

      databaseSelector.val(config.databases[0]);
      databaseSelector.change();
    });

    databaseSelector.on('change', function() {
      $.getJSON('schema.php?db=' + $(this).val(), function(schema) {
        editor.setOption('hintOptions', {tables: schema});
      });
    });
  };
}());