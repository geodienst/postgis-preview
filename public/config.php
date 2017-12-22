<?php

require '../util.php';

print_json([
	'databases' => array_keys(config_databases())
]);