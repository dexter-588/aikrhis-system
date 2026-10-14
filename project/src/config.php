<?php
declare(strict_types=1);

/**
 * MongoDB configuration.
 * Change these environment variables when deploying:
 * MONGODB_URI, MONGODB_DATABASE, MONGODB_COLLECTION
 */
const MONGODB_URI = 'mongodb://127.0.0.1:27017';
const MONGODB_DATABASE = 'STUDENT_INFORMATION';
const MONGODB_COLLECTION = 'students';

function mongoClient(): MongoDB\Client
{
    if (!extension_loaded('mongodb')) {
        throw new RuntimeException('The PHP MongoDB extension is not enabled.');
    }
    $uri = getenv('MONGODB_URI') ?: MONGODB_URI;
    return new MongoDB\Client($uri);
}

function studentsCollection(): MongoDB\Collection
{
    $database = getenv('MONGODB_DATABASE') ?: MONGODB_DATABASE;
    $collection = getenv('MONGODB_COLLECTION') ?: MONGODB_COLLECTION;

    return mongoClient()->selectCollection($database, $collection);
}
