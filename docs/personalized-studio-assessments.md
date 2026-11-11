# Personalized Adminerva Studio Assessments

Status: implementation candidate in PR #153. The frontend, Firestore rules and
`studioAssessmentVariant` callable are one release boundary.

## Purpose

Personalized Studio assessments are a generic assessment capability. They are
not tied to OOP, Java, or any single programming topic.

The teacher creates the normal assessment blueprint first: title, student
instructions, maximum score and published rubric. When **Personalized task
variants** is enabled, Adminerva AI uses that blueprint as the authoritative
source and prepares a private pool of equivalent learner tasks.

The content can therefore be Java OOP, arrays, loops, debugging, Python, SQL,
HTML/CSS/JavaScript or another programming task as long as the teacher describes
the intended scope clearly enough for equivalent variants to be generated.

Personalization changes the concrete problem. It must not change the competency,
difficulty, required effort or rubric.

## Authoring workflow

1. Create the assessment normally in Assessment Studio.
2. Choose **Adminerva Studio project snapshot** as the submission workspace.
3. Enable **Personalized task variants**.
4. Write the authoritative student instructions. This is where the teacher
   defines the topic and scope.
5. Prepare the published rubric.
6. Optionally write **Variation guidance** describing what may change and what
   must remain fixed.
7. Choose a private variant pool size from 10 to 50.
8. Select **Generate / refresh variants with AI**.
9. Review the sample variants shown in Assessment Studio.
10. Save the blueprint.
11. Deploy only after the saved variant pool matches the current blueprint.

If the title, instructions, rubric, maximum score, subject, variation guidance
or requested pool size changes, the personalization fingerprint changes.
Deployment is blocked until a current pool is generated and saved.

## Generic generation contract

For each AI generation batch, Adminerva supplies:

- assessment title;
- authoritative student instructions;
- published rubric;
- optional teacher variation guidance;
- a generation nonce and recent variant summaries to reduce repetition.

The generator is instructed to preserve:

- programming language and platform;
- learning objectives and required concepts;
- task scope;
- difficulty and expected effort;
- compatibility with the same published rubric.

The generator may vary only details that can change without changing the
assessed competency, such as:

- scenario or problem framing;
- class, function, method or variable identifiers;
- literal values;
- small datasets or example inputs;
- required output details.

The generator must not introduce concepts, frameworks, APIs, databases,
libraries or file requirements that contradict or exceed the teacher's
blueprint.

Each generated record contains:

- `prompt`: the learner-visible task;
- `evaluationNotes`: private variant-specific notes for teacher/evaluator
  review;
- `summary`: a short generation-time description used to reduce duplication.

The private pool is saved only in `assessment_private/{assessmentId}`.
Students do not receive the whole pool or the private evaluation notes.

## Attempt and uniqueness contract

1. A learner opens a deployed personalized Studio assessment.
2. The server resolves the learner from the verified account and assigned class.
3. The server reads the teacher-approved private pool.
4. If the current attempt has no assigned variant, the server chooses one unused
   variant and records it for that learner and attempt.
5. Reloading, closing and reopening Studio returns the same variant.
6. Submission freezes the Studio project and stores the assigned `variantId`
   on both the submission head and immutable submitted version.
7. Firestore rejects a personalized submission when its variant ID does not
   match the server-issued variant for that learner/revision.
8. Teacher review retrieves the exact prompt and private evaluation notes and
   verifies the submitted variant ID.
9. A teacher-requested revision advances the submission revision. The next
   attempt receives another unused variant from the same approved pool.

Simply refreshing Studio or closing/reopening the overall assessment does not
reroll an unfinished learner task. This prevents learners from repeatedly
requesting a more favorable task.

## Pool limits

The first implementation supports 10–50 prepared variants and bounds the
serialized private pool before saving it. The pool should normally cover the
expected learner count plus reasonable revision headroom.

If all variants are assigned, the server fails closed and tells the learner to
ask the teacher for additional assessment support rather than silently reusing
another learner's task.

A future enhancement can support pool replenishment after deployment without
changing the public blueprint or rubric.

## Mini PETA 3 example — Java OOP

Mini PETA 3 is an example use of the generic feature, not a hard-coded recipe.

Recommended blueprint:

| Field | Value |
| --- | --- |
| Title | Mini PETA 3 – Personalized OOP Programming Task |
| Type | Mini PETA |
| Maximum score | 10 |
| Submission workspace | Adminerva Studio project snapshot |
| Personalized task variants | On |
| Pool size | 40 or enough for the class plus revision headroom |
| Suggested open date | November 16, 2026 |
| Deadline | November 20, 2026, 11:59 PM Asia/Manila |
| Practical exam restrictions | Off for normal take-home work |

Example authoritative student context:

> Create a Java console application that demonstrates introductory
> object-oriented programming. Your assigned task must require a class with
> meaningful fields, a constructor, methods that work with object state, object
> instantiation in the main program, and visible output showing the objects in
> use. Keep fields appropriately encapsulated. Inheritance, interfaces,
> databases, GUI programming and external APIs are not required for this Mini
> PETA.

Example variation guidance:

> Keep the same introductory OOP competencies and comparable difficulty for
> every learner. Vary the real-world scenario, class name, field names, method
> names, object names, literal values and required output details. Require at
> least two object instances. Do not introduce inheritance, polymorphism,
> interfaces, databases, files, Android UI or external libraries.

The teacher remains responsible for the common 10-point rubric. For example,
the rubric can assess class/object design, constructor/initialization, methods
and object state, program behavior/output, and code quality. Adminerva does not
hard-code those criteria into the personalization engine.

## Teacher review

Teacher review shows, together:

- the common assessment instructions;
- the common published rubric;
- the exact learner-specific prompt;
- private variant evaluation notes;
- the frozen submitted Studio files;
- the variant ID and submission revision.

The common rubric remains authoritative. Variant evaluation notes may clarify
the exact values, identifiers or expected behavior for that learner but may not
create new grading criteria.

## Security and reliability

- Students never choose the random assignment or AI seed.
- Students cannot call the general teacher AI generation endpoint through this
  feature.
- AI generation happens during teacher authoring, not when a learner opens the
  assessment.
- An AI/provider outage therefore does not block students after deployment.
- The full variant pool is teacher-private.
- Exact variants are assigned server-side.
- Variant IDs are bound to submitted snapshots.
- A stale variant pool cannot be deployed.

## Release boundary

The feature changes:

- Assessment Studio authoring;
- teacher-side AI generation of private variant pools;
- server-side per-attempt variant allocation;
- student Studio task display;
- Studio submission variant binding;
- Firestore validation;
- teacher Studio review;
- focused topic-agnostic variant tests.

Do not deploy only the static frontend. The callable and Firestore rules are
part of the same feature boundary.
