# Keep numbering-system data together

`digits.js` keeps each numbering system's regular-expression range and UTF-16
range in one table. `digitRegex` reads the expression, while `parseDigits`
reads the numeric bounds.

This removes the duplicated set of numbering-system keys and makes it
impossible to add or rename a positional numbering system in only one of the
two tables. The Han decimal and Latin entries have no UTF-16 bounds because
their existing special paths remain unchanged.
