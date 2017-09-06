<?php

error_reporting(E_ALL);
ini_set('display_errors', true);

ignore_user_abort(false);

function print_json($data) {
	header('Content-Type: application/json');
	echo json_encode($data, JSON_PRETTY_PRINT);
}

function connect($url)
{
	$pdo = new PDO($url);
	$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
	return $pdo;
}

function query_columns($pdo, $query)
{
	$stmt = $pdo->query('SELECT q.* FROM (' . $query . ') AS q LIMIT 0');

	$columns = [];

	for ($i = 0; $i < $stmt->columnCount(); ++$i) {
		$meta = $stmt->getColumnMeta($i);
		$columns[$meta['name']] = $meta['native_type'];
	}

	return $columns;
}

function query_geojson($pdo, $user_query, &$query)
{
	// First determine the column types
	$columns = query_columns($pdo, $user_query);
		
	// Pick all the geometry columns
	$geometry_columns = array_keys($columns, 'geometry');

	if (count($geometry_columns) === 0)
		throw new Exception('Query does not contain any geometry columns');

	// Create the outer select query, but give the geometry columns special
	// treatment (as in convert those to GeoJSON and WGS84)
	$sql_fields = array_map(function($field, $type) {
		if ($type == 'geometry')
			return sprintf('ST_AsGeoJSON(ST_Transform(q."%s", 4326)) as "%1$s"', $field);
		else
			return sprintf('q."%s"', $field);
	}, array_keys($columns), $columns);

	// Generate the real query with the user query as inner query
	$query = 'SELECT ' . implode(', ', $sql_fields) . ' FROM (' . $user_query . ') AS q';

	$stmt = $pdo->query($query);

	$features = [];

	// Convert the final result set to one large GeoJSON Feature collection
	while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
		foreach ($geometry_columns as $geometry_column) {
			$features[] = [
				'type' => 'Feature',
				'properties' => array_diff_key($row, array_flip($geometry_columns)),
				'geometry' =>  json_decode($row[$geometry_column])
			];
		}
	}

	return [
		'type' => 'FeatureCollection',
		'_query' => $query,
		'_columns' => $columns,
		'features' => $features
	];
}

function query_csv($pdo, $user_query, &$query)
{
	// First determine the column types
	$columns = query_columns($pdo, $user_query);
		
	// Pick all the geometry columns
	$geometry_columns = array_keys($columns, 'geometry');

	// Create the outer select query, but give the geometry columns special
	// treatment (as in convert those to GeoJSON and WGS84)
	$sql_fields = array_map(function($field, $type) {
		if ($type == 'geometry')
			return sprintf('ST_AsEWKT(q."%s") as "%1$s"', $field);
		else
			return sprintf('q."%s"', $field);
	}, array_keys($columns), $columns);

	// Generate the real query with the user query as inner query
	$query = 'SELECT ' . implode(', ', $sql_fields) . ' FROM (' . $user_query . ') AS q';

	$stmt = $pdo->query($query);

	$stdout = fopen('php://output', 'w');

	header('Content-Type: text/csv');

	// Write column headers
	fputcsv($stdout, array_keys($columns));

	while ($row = $stmt->fetch(PDO::FETCH_ASSOC))
		fputcsv($stdout, $row);
}

$query = null;
	
try {
	$format = isset($_GET['format']) ? $_GET['format'] : 'geojson';

	if (empty($_GET['q']))
		throw new RuntimeException('Missing query parameter');

	$user_query = rtrim($_GET['q'], ';');

	$config = require '../config.php';
	$pdo = connect($config['DATABASE_URL']);

	switch ($format) {
		case 'geojson':
			$output = query_geojson($pdo, $user_query, $query);
			print_json($output);
			break;

		case 'csv':
			query_csv($pdo, $user_query, $query);
			break;

		default:
			throw new RuntimeException('Unknown/unsupported output format: try geojson or csv');
	}
} catch (Exception $e) {
	print_json([
		'error' => $e->getMessage(),
		'query' => $query
	]);
}