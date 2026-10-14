# Student Information System

This is a clean PHP Student Information System demonstrating:
- Variables and data types
- GET and POST forms
- Conditional statements (`if`, `else`, `switch`)
- Loops (`for`, `while`, `foreach`)
- Arrays
- Functions
- MongoDB connection
- Full CRUD operations

## Requirements
- PHP 8+
- MongoDB server running locally
- Composer installed

## Setup
1. Open a terminal in the `project` folder.
2. Run `composer install`.
3. Start the PHP server:
   `php -S localhost:8000 -t public`
4. Open `http://localhost:8000` in your browser.

## Notes
- Database: `STUDENT_INFORMATION`
- Collection: `students`
- Configure a different server with `MONGODB_URI`, `MONGODB_DATABASE`, and `MONGODB_COLLECTION` environment variables.

## Project structure

```
public/              # Browser-accessible files
  index.php          # GET/POST routes and page views
  assets/style.css   # Application styling
src/
  config.php         # MongoDB connection settings
  functions.php      # Validation, CRUD, helpers, and data arrays
  template.php       # Shared layout helpers
```

## PHP concepts demonstrated

- **Variables/data types:** typed variables, string-to-integer age conversion, arrays.
- **GET forms:** directory search and status filter.
- **POST forms:** create, update, and secure delete actions.
- **Conditionals:** `if`, `else`, and `switch` routing.
- **Loops:** `foreach` for select options and student records.
- **Functions:** reusable validation, CRUD, escaping, CSRF, and layout functions.
