<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function clean(string $value): string
{
    return trim($value);
}

function courses(): array
{
    return ['Computer Science', 'Information Technology', 'Engineering', 'Business Administration'];
}

function yearLevels(): array
{
    $suffixes = [1 => 'st', 2 => 'nd', 3 => 'rd', 4 => 'th'];
    $levels = [];
    for ($year = 1; $year <= 4; $year++) { // for loop: build the program year options
        $levels[] = $year . $suffixes[$year] . ' Year';
    }
    return $levels;
}

function statuses(): array
{
    return ['Enrolled', 'Graduated', 'Dropped'];
}

function emptyStudent(): array
{
    return ['student_id' => '', 'name' => '', 'age' => '', 'course' => '', 'year_level' => '', 'status' => 'Enrolled'];
}

function validateStudent(array $input): array
{
    $student = [
        'student_id' => clean((string) ($input['student_id'] ?? '')),
        'name' => clean((string) ($input['name'] ?? '')),
        'age' => clean((string) ($input['age'] ?? '')),
        'course' => clean((string) ($input['course'] ?? '')),
        'year_level' => clean((string) ($input['year_level'] ?? '')),
        'status' => clean((string) ($input['status'] ?? '')),
    ];
    $errors = [];

    if ($student['student_id'] === '') $errors['student_id'] = 'Student ID is required.';
    if ($student['name'] === '') $errors['name'] = 'Student name is required.';
    if (filter_var($student['age'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 120]]) === false) $errors['age'] = 'Enter an age from 1 to 120.';
    if (!in_array($student['course'], courses(), true)) $errors['course'] = 'Choose a valid course.';
    if (!in_array($student['year_level'], yearLevels(), true)) $errors['year_level'] = 'Choose a valid year level.';
    if (!in_array($student['status'], statuses(), true)) $errors['status'] = 'Choose a valid status.';

    $student['age'] = (int) $student['age']; // variable type conversion: string to integer
    return [$student, $errors];
}

function studentObjectId(string $id): ?MongoDB\BSON\ObjectId
{
    try {
        return new MongoDB\BSON\ObjectId($id);
    } catch (Throwable) {
        return null;
    }
}

function allStudents(string $search = '', string $status = ''): array
{
    $filter = [];
    if ($search !== '') {
        $filter['$or'] = [
            ['student_id' => ['$regex' => preg_quote($search), '$options' => 'i']],
            ['name' => ['$regex' => preg_quote($search), '$options' => 'i']],
        ];
    }
    if (in_array($status, statuses(), true)) $filter['status'] = $status;

    return studentsCollection()->find($filter, ['sort' => ['created_at' => -1]])->toArray();
}

function findStudent(string $id): ?object
{
    $objectId = studentObjectId($id);
    return $objectId ? studentsCollection()->findOne(['_id' => $objectId]) : null;
}

function studentIdExists(string $studentId, ?string $exceptId = null): bool
{
    $filter = ['student_id' => $studentId];
    $exceptObjectId = $exceptId ? studentObjectId($exceptId) : null;
    if ($exceptObjectId) $filter['_id'] = ['$ne' => $exceptObjectId];
    return studentsCollection()->countDocuments($filter) > 0;
}

function createStudent(array $student): void
{
    $student['created_at'] = new MongoDB\BSON\UTCDateTime();
    studentsCollection()->insertOne($student);
}

function updateStudent(string $id, array $student): bool
{
    $objectId = studentObjectId($id);
    if (!$objectId) return false;
    $student['updated_at'] = new MongoDB\BSON\UTCDateTime();
    studentsCollection()->updateOne(['_id' => $objectId], ['$set' => $student]);
    return true;
}

function deleteStudent(string $id): bool
{
    $objectId = studentObjectId($id);
    return $objectId ? studentsCollection()->deleteOne(['_id' => $objectId])->getDeletedCount() === 1 : false;
}

function csrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf_token'];
}

function verifyCsrf(): bool
{
    return isset($_POST['csrf_token'], $_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], (string) $_POST['csrf_token']);
}

function flash(string $message = null): ?string
{
    if ($message !== null) { $_SESSION['flash'] = $message; return null; }
    $message = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $message;
}
