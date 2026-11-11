# Personalized Adminerva Studio Assessments

Status: implementation candidate in PR #153. Frontend, Firestore rules and the
`studioAssessmentVariant` callable must be released together.

## Purpose

Personalized Studio assessments let one teacher blueprint assess the same
competencies while issuing different concrete programming requirements to each
learner. Personalization is server-owned so a learner cannot choose the seed or
request another variant simply by refreshing the browser.

This is assessment personalization, not adaptive difficulty. Learners within
the same blueprint must receive comparable competency requirements and scoring
weight.

## Attempt contract

1. A learner opens a deployed personalized Studio assessment.
2. The server resolves the learner from the verified school account and class.
3. If the current attempt has no variant, the server creates one with
   cryptographic randomness and reserves its prompt fingerprint within that
   assessment.
4. Reloading, closing and reopening Studio returns the same variant for the
   current attempt.
5. Submission freezes the Studio project snapshot and stores the issued
   `variantId` on both the submission head and immutable version record.
6. Firestore rejects a personalized submission when its revision and variant ID
   do not match the server-issued attempt.
7. Teacher review retrieves the exact recorded prompt and verifies its variant
   ID before grading.
8. A teacher-requested student revision advances the submission revision. The
   next Studio open receives a new unique variant for that new attempt.

Closing and later reopening the overall assessment lifecycle does not reroll a
learner's unfinished attempt. Only a genuine learner revision/attempt change
does so. This prevents learners from rerolling until they prefer a particular
task.

## Uniqueness and privacy

Variant generation uses Node `crypto.randomBytes` in the callable backend.
The browser does not select a seed. A SHA-256 prompt fingerprint is reserved in
an assessment-scoped registry, preventing the same exact variant from being
issued twice within that assessment.

Variant records and the uniqueness registry are server-owned. Students receive
only their own variant through the authenticated callable. Teacher inspection is
limited to staff authorized for the assessment/student context.

## Recipe model

Blueprints store:

- `personalizedTask.enabled`
- `personalizedTask.generator`
- `personalizedTask.regeneration = "new_attempt"`
- `personalizedTask.uniqueWithinAssessment = true`

Supported initial recipes:

### Java OOP Fundamentals — `java_oop_fundamentals_v1`

Every learner is assessed on the same OOP competencies:

- one assigned public class in its own Java file;
- two assigned private instance fields;
- a constructor that initializes fields with `this`;
- one assigned public instance method that modifies object state;
- one assigned display method;
- two object instances with assigned object-variable names and starting values;
- state changes on both objects;
- output produced from object state after the updates;
- readable two-file Java organization.

The generator varies the scenario, class name, field names, method names,
parameter name, object names, text values, numeric values, update amounts and
display method name. Inheritance, interfaces, databases, GUI code and advanced
frameworks are intentionally excluded from this first OOP recipe.

### Java Logic — `java_logic_written_work_v1`

The earlier recipe remains available for variables, arithmetic expressions,
conditional logic and output.

## Mini PETA 3 — first planned use

Recommended blueprint:

| Field | Value |
| --- | --- |
| Title | Mini PETA 3 – Personalized Java OOP Challenge |
| Type | Mini PETA |
| Maximum score | 10 |
| Submission workspace | Adminerva Studio project snapshot |
| Personalized task variants | On |
| Recipe | Java OOP Fundamentals |
| Practical exam restrictions | Off for normal take-home work |
| Suggested open date | November 16, 2026 |
| Deadline | November 20, 2026, 11:59 PM Asia/Manila |

Recommended common student context:

> Complete your assigned Mini PETA 3 in Adminerva Studio. Adminerva will issue
> an individual Java OOP task for your current attempt. Follow the exact class,
> field, constructor, method, object and output requirements displayed in
> Studio. Your current task remains the same when you reload or reopen Studio.
> If your teacher formally requests a new revision, the new attempt receives a
> different task. Submit the completed Studio project before the deadline.

Use **Use recipe rubric** after setting the maximum score to 10. The generated
rubric is:

1. Class and encapsulation — 2 points.
2. Constructor and initialization — 2 points.
3. Instance behavior — 2 points.
4. Objects and required output — 2 points.
5. Code quality — 2 points.

The teacher grades the exact frozen Studio snapshot against the learner's exact
recorded variant. Suggested or future automated evaluation must use that variant
as authoritative task context and must not grade excluded OOP topics.

## Release boundary

This feature changes:

- Assessment Studio blueprint authoring;
- personalized variant generation in Cloud Functions;
- student Studio task display and submission binding;
- Firestore Studio submission validation;
- teacher Studio submission review;
- focused variant generator tests.

Do not deploy only the static frontend. The callable and Firestore rules are
part of the same feature boundary.

## Future recipes

The generator registry is intentionally extensible. Later recipes can cover
arrays, loops, methods, inheritance, polymorphism, exceptions, SQL, HTML/CSS/JS
or teacher-authored parameter pools without changing the attempt lifecycle
contract.
