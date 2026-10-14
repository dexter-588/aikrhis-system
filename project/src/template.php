<?php
declare(strict_types=1);

function renderHeader(string $title): void
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . e($title) . '</title><link rel="stylesheet" href="assets/style.css"></head><body><header class="site-header"><div class="container nav"><a class="brand" href="index.php">SIS<span>•</span></a><nav><a href="index.php">Students</a><a class="button" href="index.php?action=create">+ Add Student</a></nav></div></header><main class="container">';
}

function renderFooter(): void
{
    echo '</main><footer class="container footer">Student Information System · PHP & MongoDB</footer></body></html>';
}

function renderFlash(?string $message): void
{
    if ($message) echo '<div class="alert success">' . e($message) . '</div>';
}

function renderFieldError(array $errors, string $field): void
{
    if (isset($errors[$field])) echo '<small class="error">' . e($errors[$field]) . '</small>';
}
