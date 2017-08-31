<?php

error_reporting(E_ALL);
ini_set('display_errors', true);

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

function quote_list($pdo, $list)
{
	return implode(', ', array_map([$pdo, 'quote'], $list));
}

function query_schema($pdo)
{
	$excluded_schemas = [
		'information_schema',
		'pg_catalog'
	];

	$excluded_postgis_tables = [
		'spatial_ref_sys',
		'geography_columns',
		'geometry_columns',
		'raster_columns',
		'raster_overviews'
	];

	$sql_query = "
		SELECT
			t.table_schema,
			t.table_name,
			array_to_json(array_agg(c.column_name::text)) as columns
		FROM
			information_schema.tables t
		LEFT JOIN information_schema.columns c
			ON c.table_catalog = t.table_catalog
			AND c.table_schema = t.table_schema
			AND c.table_name = t.table_name
		WHERE
			t.table_schema NOT IN (" . quote_list($pdo, $excluded_schemas) .")
			AND NOT (t.table_schema = 'public' AND t.table_name IN(" . quote_list($pdo, $excluded_postgis_tables) . "))
		GROUP BY
			t.table_schema,
			t.table_name
		ORDER BY
			t.table_schema ASC,
			t.table_name ASC
	";

	$stmt = $pdo->query($sql_query);

	$tables = [];

	while ($row = $stmt->fetch(PDO::FETCH_ASSOC))
	{
		if ($row['table_schema'] == 'public')
			$name = $row['table_name'];
		else
			$name = $row['table_schema'] . '.' . $row['table_name'];

		$tables[$name] = json_decode($row['columns']);
	}

	return $tables;
}

try {
	$config = require '../config.php';
	$pdo = connect($config['DATABASE_URL']);

	$schema = query_schema($pdo);
	print_json($schema);
} catch (Exception $e) {
	print_json([
		'error' => $e->getMessage()
	]);
}