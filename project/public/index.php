<?php
declare(strict_types=1);

session_start();
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/functions.php';
require_once __DIR__ . '/../src/template.php';

$action = (string) ($_GET['action'] ?? 'list');
$student = emptyStudent();
$errors = [];
$search = clean((string) ($_GET['search'] ?? ''));
$statusFilter = clean((string) ($_GET['status'] ?? ''));
$students = [];

try {
    switch ($action) {
        case 'create':
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                $csrfValid = verifyCsrf();
                [$student, $errors] = validateStudent($_POST);
                if (!$csrfValid) $errors['form'] = 'Your session expired. Please submit the form again.';
                if (!$errors && studentIdExists($student['student_id'])) $errors['student_id'] = 'This Student ID is already in use.';
                if (!$errors) { createStudent($student); flash('Student record created successfully.'); header('Location: index.php'); exit; }
            }
            break;
        case 'edit':
            $id = (string) ($_GET['id'] ?? $_POST['id'] ?? '');
            $record = findStudent($id);
            if (!$record) { flash('Student record was not found.'); header('Location: index.php'); exit; }
            $student = (array) $record;
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                $csrfValid = verifyCsrf();
                [$student, $errors] = validateStudent($_POST);
                if (!$csrfValid) $errors['form'] = 'Your session expired. Please submit the form again.';
                if (!$errors && studentIdExists($student['student_id'], $id)) $errors['student_id'] = 'This Student ID is already in use.';
                if (!$errors && updateStudent($id, $student)) { flash('Student record updated successfully.'); header('Location: index.php'); exit; }
            }
            break;
        case 'delete':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !verifyCsrf()) { flash('Invalid delete request.'); header('Location: index.php'); exit; }
            flash(deleteStudent((string) ($_POST['id'] ?? '')) ? 'Student record deleted.' : 'Student record was not found.');
            header('Location: index.php'); exit;
        case 'view': $student = findStudent((string) ($_GET['id'] ?? '')); break;
        default:
            $action = 'list';
            $students = allStudents($search, $statusFilter);
    }
} catch (Throwable) {
    $errors['form'] = 'MongoDB is not ready. Enable the PHP MongoDB extension (ext-mongodb), then make sure the MongoDB server is running.';
    if ($action === 'view') $student = null;
}

renderHeader($action === 'list' ? 'Students' : ucfirst($action) . ' Student');
renderFlash(flash());
if (isset($errors['form'])) echo '<div class="alert error-alert">' . e($errors['form']) . '</div>';

if ($action === 'create' || $action === 'edit'):
    $editing = $action === 'edit'; ?>
    <section class="card form-card"><div><p class="eyebrow"><?= $editing ? 'Update record' : 'New record' ?></p><h1><?= $editing ? 'Edit student' : 'Add a student' ?></h1><p class="muted">Fields marked with * are required.</p></div>
    <form method="post" action="index.php?action=<?= e($action) ?><?= $editing ? '&amp;id=' . e((string) $_GET['id']) : '' ?>" class="student-form">
        <input type="hidden" name="csrf_token" value="<?= e(csrfToken()) ?>"><?php if ($editing): ?><input type="hidden" name="id" value="<?= e((string) $_GET['id']) ?>"><?php endif; ?>
        <label>Student ID *<input name="student_id" value="<?= e($student['student_id']) ?>" required><?= renderFieldError($errors, 'student_id') ?></label>
        <label>Full name *<input name="name" value="<?= e($student['name']) ?>" required><?= renderFieldError($errors, 'name') ?></label>
        <label>Age *<input type="number" name="age" min="1" max="120" value="<?= e($student['age']) ?>" required><?= renderFieldError($errors, 'age') ?></label>
        <label>Course *<select name="course" required><option value="">Select a course</option><?php foreach (courses() as $course): ?><option value="<?= e($course) ?>" <?= $student['course'] === $course ? 'selected' : '' ?>><?= e($course) ?></option><?php endforeach; ?></select><?= renderFieldError($errors, 'course') ?></label>
        <label>Year level *<select name="year_level" required><option value="">Select year level</option><?php foreach (yearLevels() as $level): ?><option value="<?= e($level) ?>" <?= $student['year_level'] === $level ? 'selected' : '' ?>><?= e($level) ?></option><?php endforeach; ?></select><?= renderFieldError($errors, 'year_level') ?></label>
        <label>Status *<select name="status" required><?php foreach (statuses() as $status): ?><option value="<?= e($status) ?>" <?= $student['status'] === $status ? 'selected' : '' ?>><?= e($status) ?></option><?php endforeach; ?></select><?= renderFieldError($errors, 'status') ?></label>
        <div class="form-actions"><a href="index.php" class="button secondary">Cancel</a><button type="submit" class="button"><?= $editing ? 'Save changes' : 'Create student' ?></button></div>
    </form></section>
<?php elseif ($action === 'view'): ?>
    <section class="card"><?php if (!$student): ?><h1>Student not found</h1><p class="muted">This record may have been deleted.</p><?php else: ?><p class="eyebrow">Student profile</p><h1><?= e($student->name) ?></h1><div class="detail-grid"><div><span>Student ID</span><?= e($student->student_id) ?></div><div><span>Age</span><?= e($student->age) ?></div><div><span>Course</span><?= e($student->course) ?></div><div><span>Year level</span><?= e($student->year_level) ?></div><div><span>Status</span><strong class="status <?= strtolower(e($student->status)) ?>"><?= e($student->status) ?></strong></div></div><div class="form-actions"><a class="button secondary" href="index.php">Back</a><a class="button" href="index.php?action=edit&amp;id=<?= e($student->_id) ?>">Edit student</a></div><?php endif; ?></section>
<?php else:
    ?>
    <section class="page-heading"><div><p class="eyebrow">Student directory</p><h1>Students</h1><p class="muted">Manage student records in one place.</p></div><a class="button" href="index.php?action=create">+ Add Student</a></section>
    <section class="card"><form method="get" class="filters"><input type="search" name="search" placeholder="Search ID or name" value="<?= e($search) ?>"><select name="status"><option value="">All statuses</option><?php foreach (statuses() as $status): ?><option value="<?= e($status) ?>" <?= $statusFilter === $status ? 'selected' : '' ?>><?= e($status) ?></option><?php endforeach; ?></select><button class="button" type="submit">Search</button><a href="index.php" class="clear-link">Clear</a></form>
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Age</th><th>Course</th><th>Year</th><th>Status</th><th></th></tr></thead><tbody><?php if (!$students): ?><tr><td colspan="6" class="empty">No student records found.</td></tr><?php endif; ?><?php $rowIndex = 0; while ($rowIndex < count($students)): $row = $students[$rowIndex++]; ?><tr><td><strong><?= e($row->name) ?></strong><small><?= e($row->student_id) ?></small></td><td><?= e($row->age) ?></td><td><?= e($row->course) ?></td><td><?= e($row->year_level) ?></td><td><span class="status <?= strtolower(e($row->status)) ?>"><?= e($row->status) ?></span></td><td class="actions"><a href="index.php?action=view&amp;id=<?= e($row->_id) ?>">View</a><a href="index.php?action=edit&amp;id=<?= e($row->_id) ?>">Edit</a><form method="post" action="index.php?action=delete" onsubmit="return confirm('Delete this student record?');"><input type="hidden" name="csrf_token" value="<?= e(csrfToken()) ?>"><input type="hidden" name="id" value="<?= e($row->_id) ?>"><button class="delete" type="submit">Delete</button></form></td></tr><?php endwhile; ?></tbody></table></div></section>
<?php endif; renderFooter();
