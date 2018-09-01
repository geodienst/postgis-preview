<?php

error_reporting(E_ALL);
ini_set('display_errors', true);

set_time_limit(300);

ignore_user_abort(false);

require '../util.php';

class GeoQuery
{
	protected $with_atoms = [];

	protected $bbox;

	protected $limit;

	protected $query;

	public $columns = [];

	public $geometry_columns = [];

	public $sql;

	public function __construct($query)
	{
		// If the query starts with a "WITH xxx AS yyy, etc." statement, extract that part and
		// add it to the with_atoms array. These, together with the layers added by addGeoJSON,
		// are prepended to the final query.
		if (preg_match('/^WITH (\w+ AS \(.+?\)(,\s*\w+ AS \(.+?\))*)(.+?)$/i', $query, $match)) {
			$this->with_atoms[] = $match[1];
			$this->query = $match[2];
		} else {
			$this->query = $query;
		}
	}

	public function addGeoJSON($name, $data)
	{
		if (!preg_match('/^[a-z][a-z0-9_]*$/', $name))
			throw new InvalidArgumentException('Invalid geojson layer name');

		$json = json_encode($data);

		$this->with_atoms = array_merge($this->with_atoms, [
			"{$name}_data AS (SELECT '{$json}'::json as fc)",
			"{$name}_features AS (SELECT json_array_elements(fc->'features') as feature FROM {$name}_data)",
			"{$name} AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326) as geom FROM {$name}_features)"
		]);
	}

	public function setBBox($bbox)
	{
		$envelope = array_map('floatval', explode(',', $bbox));

		if (count($envelope) !== 4)
			throw new InvalidArgumentException('Malformed bbox parameter');
		
		$this->bbox = $envelope;
	}

	public function setLimit($limit)
	{
		$this->limit = $limit;
	}

	protected function _addWithStatement($query)
	{
		if (count($this->with_atoms) === 0)
			return $query;

		return sprintf('WITH %s %s', implode("\n,", $this->with_atoms), $query);
	}

	protected function _addBboxCondition($query)
	{
		if ($this->bbox === null)
			return $query;

		$bbox_conditions = [];

		foreach ($this->geometry_columns as $column)
			$bbox_conditions[] = vsprintf('(ST_Transform(q."%s", 4326) && ST_MakeEnvelope(%f, %f, %f, %f))',
				array_merge([$column], $this->bbox));

		return $query . ' WHERE ' . implode(' OR ', $bbox_conditions);
	}

	protected function _addLimit($query)
	{
		return $this->limit !== null
			? sprintf('%s LIMIT %d', $query, $this->limit)
			: $query;
	}

	protected  function _queryColumns(PDO $pdo)
	{
		$query = 'SELECT q.* FROM (' . $this->query . ') AS q LIMIT 0';

		$query = $this->_addWithStatement($query);

		$stmt = $pdo->query($query);

		$columns = [];

		for ($i = 0; $i < $stmt->columnCount(); ++$i) {
			$meta = $stmt->getColumnMeta($i);
			$columns[$meta['name']] = $meta['native_type'];
		}

		return $columns;
	}

	public function execute(PDO $pdo, $field_formatter = null)
	{
		if ($field_formatter === null)
			$field_formatter = function($field, $type) {
				return sprintf('q."%s"', $field);
			};
		
		$this->columns = $this->_queryColumns($pdo);

			// Pick all the geometry columns
		$this->geometry_columns = array_keys($this->columns, 'geometry');

		if (count($this->geometry_columns) === 0)
			throw new Exception('Query does not contain any geometry columns');

		// Create the outer select query, but give the geometry columns special
		// treatment (e.g. convert those to GeoJSON and WGS84)
		$sql_fields = array_map($field_formatter, array_keys($this->columns), $this->columns);

		// Create the final select query
		$query = 'SELECT ' . implode(', ', $sql_fields) . ' FROM (' . $this->query . ') AS q';

		// Add the WITH statement
		$query = $this->_addWithStatement($query);

		// If there is a bbox filter, add that as a condition to final result query
		$query = $this->_addBboxCondition($query);

		// Add a limit to the result query if necessary
		$query = $this->_addLimit($query);

		// For debugging
		$this->sql = $query;

		// This adds the 'with' statement and runs the query
		return $pdo->query($query);
	}
}

function is_associative($data) {
	if (is_array($data)) {
		$expected = 0;

		foreach ($data as $key => $value)
			if ($key !== $expected++)
				return true;

		return false;
	}
	else if (is_object($data)) {
		if ($data instanceof \Iterator)
			return $data->valid() && $data->key() !== 0;
		
		return true;
	} else {
		return false;
	}
}

function stream_json($fh, $data) {
	$is_object = is_associative($data);
	$is_array = !$is_object && (is_object($data) || is_array($data));

	if ($is_array || $is_object) {
		fwrite($fh, $is_object ? '{' : '[');
		
		$first = true;
		foreach ($data as $key => $element) {
			if (!$first)
				fwrite($fh, ',');
			else
				$first = false;

			if ($is_object)
				fwrite($fh, json_encode((string) $key) . ':');

			stream_json($fh, $element);
		}

		fwrite($fh, $is_object ? '}' : ']');
	}
	else {
		fwrite($fh, json_encode($data));
	}
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

function query_geojson($pdo, $query)
{
	$start_time = microtime(true);

	$stmt = $query->execute($pdo, function($field, $type) {
		if ($type == 'geometry')
			return sprintf('ST_AsGeoJSON(ST_Transform(q."%s", 4326)) as "%1$s"', $field);
		else
			return sprintf('q."%s"', $field);
	});

	$execution_time = microtime(true) - $start_time;

	// Convert the final result set to one large GeoJSON Feature collection
	$feature_iterator = function() use ($stmt, $query) {
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			foreach ($query->geometry_columns as $geometry_column) {
				yield [
					'type' => 'Feature',
					'properties' => array_diff_key($row, array_flip($query->geometry_columns)),
					'geometry' =>  json_decode($row[$geometry_column])
				];
			}
		}
	};

	header('Content-Type: application/json');
	$stdout = fopen('php://output', 'w');
	stream_json($stdout, [
		'type' => 'FeatureCollection',
		'_query' => $query->sql,
		'_columns' => $query->columns,
		'_timing' => $execution_time,
		'features' => $feature_iterator()
	]);
}

function query_csv($pdo, $query)
{
	$stmt = $query->execute($pdo, function($field, $type) {
		if ($type == 'geometry')
			return sprintf('ST_AsEWKT(q."%s") as "%1$s"', $field);
		else
			return sprintf('q."%s"', $field);
	});

	$stdout = fopen('php://output', 'w');

	header('Content-Type: text/csv');

	// Write column headers
	fputcsv($stdout, array_keys($query->columns));

	while ($row = $stmt->fetch(PDO::FETCH_ASSOC))
		fputcsv($stdout, $row);
}

try {
	$format = isset($_GET['format']) ? $_GET['format'] : 'geojson';

	if (empty($_GET['db']))
		throw new RuntimeException('Missing database parameter');

	if (empty($_GET['q']))
		throw new RuntimeException('Missing query parameter');

	// Remove left-over whitespace
	$query_text = trim($_GET['q']);

	// Trim leading comments
	$query_text = preg_replace('/^(\s*\/\*.*?\*\/)*\s*/s', '', $query_text);

	// Trim trailing comments
	$query_text = preg_replace('/\s*(\/\*.*?\*\/\s*)*$/s', '', $query_text);

	// Remove the trailing ';' from the query
	$query_text = rtrim($query_text, ';');

	$query = new GeoQuery($query_text);

	if (!empty($_GET['limit']))
		$query->setLimit($_GET['limit']);

	if (!empty($_GET['bbox']))
		$query->setBBox($_GET['bbox']);

	if (!empty($_GET['shapes']))
		$query->addGeoJSON('shapes', json_decode($_GET['shapes']));

	$pdo = connect($_GET['db']);

	switch ($format) {
		case 'geojson':
			query_geojson($pdo, $query);
			break;

		case 'csv':
			query_csv($pdo, $query);
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