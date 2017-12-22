<?php

function print_json($data) {
	header('Content-Type: application/json');
	echo json_encode($data, JSON_PRETTY_PRINT);
}

function config()
{
	return json_decode(file_get_contents(dirname(__FILE__) . '/config.json'), true);
}

function config_databases()
{
	return config(); // Right now the whole config is just the databases ^_^'
}

function connect($db)
{
	$databases = config_databases();

	if (!isset($databases[$db]))
		throw new InvalidArgumentException('Unknown database');

	$pdo = new PDO($databases[$db]);
	$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
	return $pdo;
}