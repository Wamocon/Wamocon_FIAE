# LFA Platform — What Has Changed and How It Works Now

**Document Version:** 2.0  
**Last Updated:** 10 March 2026  
**Prepared by:** WAMOCON GmbH — Development Team  
**For:** Management, Trainers, Support Staff, and Anyone Who Needs to Understand the Platform

---

## What This Document Covers

1. [The Big Picture — What Changed and Why](#1-the-big-picture--what-changed-and-why)
2. [What You Will See in the Platform](#2-what-you-will-see-in-the-platform)
   - 2.1 [The Menu — Who Sees What](#21-the-menu--who-sees-what)
   - 2.2 [Managing Companies (Organizations)](#22-managing-companies-organizations)
   - 2.3 [Managing Users (People)](#23-managing-users-people)
   - 2.4 [User Roles — Who Can Do What](#24-user-roles--who-can-do-what)
   - 2.5 [How a New Trainee Gets Access](#25-how-a-new-trainee-gets-access)
   - 2.6 [Light Plan vs. Pro Plan — What Each Company Gets](#26-light-plan-vs-pro-plan--what-each-company-gets)
   - 2.7 [Who Can Edit Learning Content](#27-who-can-edit-learning-content)
   - 2.8 [Language Support — German and English](#28-language-support--german-and-english)
   - 2.9 [Getting Started Tour for New Users](#29-getting-started-tour-for-new-users)
   - 2.10 [Deleting Users and Organizations](#210-deleting-users-and-organizations)
   - 2.11 [Changes to Pages You Already Know](#211-changes-to-pages-you-already-know)
3. [How Your Data Is Protected](#3-how-your-data-is-protected)
   - 3.1 [Three Layers of Protection](#31-three-layers-of-protection)
   - 3.2 [How We Keep Each Company's Data Separate](#32-how-we-keep-each-companys-data-separate)
   - 3.3 [What Stays Private, What Is Shared](#33-what-stays-private-what-is-shared)
   - 3.4 [What Happens When Someone Tries to Log In](#34-what-happens-when-someone-tries-to-log-in)
   - 3.5 [How We Prevent Accidental Data Loss](#35-how-we-prevent-accidental-data-loss)
   - 3.6 [Was Any Existing Data Affected by This Update?](#36-was-any-existing-data-affected-by-this-update)
4. [Before and After — A Quick Comparison](#4-before-and-after--a-quick-comparison)
5. [Key Terms Explained](#5-key-terms-explained)

---

## 1. The Big Picture — What Changed and Why

The LFA Platform used to serve one company — Wamocon. Now it has been upgraded so that **multiple companies can use the same platform at the same time**, each with their own trainers, trainees, and data. No company can see another company's information.

This is the foundation that allows Wamocon to offer the platform as a product to other companies (B2B). Each customer company gets their own private space on the platform, managed by Wamocon.

**Here is what we built:**

- **Company management** — Wamocon administrators can now create and manage customer companies directly in the platform, set their subscription plan, and control their access.
- **User management** — Instead of people registering themselves, Wamocon creates all accounts and sends the login details. This gives full control over who has access.
- **Four user roles** — We now have Admin, Temp Admin, Trainer, and Trainee (previously it was just Trainer and Trainee). This gives more flexibility in managing the platform.
- **Two subscription plans** — Light and Pro. Companies on the Light plan get the core learning experience. Companies on the Pro plan also get PDF downloads and access to the HAI AI assistant.
- **Complete data separation** — Every company's data is kept private at the deepest level of the system. Even if there were a software mistake, the data would still stay protected.
- **Multi-language support** — The entire platform now works in both **German** and **English**. Users can switch languages at any time.
- **Guided onboarding tour** — New users see a step-by-step walkthrough when they log in for the first time, showing them around the platform.
- **Delete capabilities** — Administrators can now permanently delete users and organizations when needed, with built-in safety checks.
- **All existing data was kept safe.** Nothing was lost, changed, or broken during this update.

---

## 2. What You Will See in the Platform

### 2.1 The Menu — Who Sees What

The left-side menu now shows different items depending on your role and which company you belong to. Not everyone sees everything — each person sees only what is relevant to them.

| Menu Item | Who Can See It |
|---|---|
| Dashboard | Everyone |
| Profile | Everyone |
| Evidence of Training | Trainers and Trainees |
| School | Trainers and Trainees |
| Courses / Learning | Trainees |
| Trainer Feedback | Trainees |
| Quizzes | Trainees |
| Trainees (list) | Trainers |
| Content Management | All trainers (view); Wamocon team only (edit) |
| Quiz Management | All trainers (view); Wamocon team only (edit) |
| Organizations | Admin and Temp Admin only |
| User Management | Admin and Temp Admin only |
| HAI (AI Assistant) | Pro plan companies only |

**What this means:** All trainers see the same menu. Content Management and Quiz Management are available to everyone, but only Wamocon's team can create, edit, or delete learning content and quizzes. Customer company trainers can view the content and manage their own uploaded PDFs. The HAI AI assistant is only visible for companies on the Pro plan.

---

### 2.2 Managing Companies (Organizations)

**Where to find it:** Click "Organizations" in the left menu (only visible to Admin and Temp Admin)

This is a brand-new section. It shows all the companies using the platform in a grid of cards.

#### What Each Company Card Shows

- The **company name** (with a crown icon if it is Wamocon)
- The **plan** — either "PRO" or "LIGHT"
- Whether the company is **Active** (green) or **Inactive** (red)
- How many **trainer and trainee accounts** are being used compared to how many were purchased (for example, "3 / 5 Trainers")
- The **contact person** and **email** for that company
- Buttons to **Edit**, **Activate/Deactivate**, and **Delete**

#### Adding a New Company

Click "New Organization" and fill in:

| Field | What It Means |
|---|---|
| Organization Name | The company's name as it will appear on the platform |
| Slug | A short ID for the company (created automatically from the name) |
| Subscription Plan | Light or Pro — decides which features the company gets |
| Max Trainee Seats | How many trainee accounts the company is allowed to have |
| Max Trainer Seats | How many trainer accounts the company is allowed to have |
| Contact Email | The main email for reaching this company |
| Contact Person | Who to talk to at this company |
| Notes | Private notes only Wamocon administrators can see |

#### Turning a Company On or Off

Each company card has a power button:

- **Turning a company off** instantly blocks all of its users from logging in. They see a message saying their organization is currently inactive.
- **Turning it back on** instantly restores access for all users. Nothing is deleted — everything is exactly as it was before.
- **Wamocon (the platform owner) cannot be turned off** — this is prevented automatically.

---

### 2.3 Managing Users (People)

**Where to find it:** Click "User Management" in the left menu (only visible to Admin and Temp Admin)

This section lets Wamocon's administrators create, edit, and manage every user account on the platform.

#### What You See

A table with all users, showing:

- Their **name and email**
- Their **role** (shown as a colored label: Admin in red, Temp Admin in orange, Trainer in blue, Trainee in green)
- Which **company** they belong to
- Their **status** — whether they are active and, for trainees, whether a trainer has approved them
- Buttons to **edit** their details and **delete** their account

#### Finding Users

You can filter the list three ways:

| Filter | What It Does |
|---|---|
| Search box | Find people by name or email |
| Organization filter | Show only people from a specific company |
| Role filter | Show only Admins, Temp Admins, Trainers, or Trainees |

#### Creating a New User

Click "Create User" and fill in:

| Field | What It Means |
|---|---|
| Full Name | The person's name |
| Email | Their login email |
| Role | Trainee, Trainer, or Temp Admin |
| Organization | Which company this person belongs to |
| Send Credentials Email | Whether to automatically email them their login details |

When you create a user:

1. A secure password is generated automatically.
2. The account is created and linked to the chosen company.
3. If you turned on "Send Credentials Email", the person receives an email with their login details.
4. You also see the credentials on screen with copy buttons, so you can share them another way if needed.
5. If the new user is a trainee, the trainers at that company get a notification saying a new trainee needs to be activated.

#### Editing a User

From the table, you can:

- **Change someone's role** (with some restrictions — see the Roles section below)
- **Move someone to a different company**
- **Turn their account on or off**
- **Activate or deactivate a trainee** (controls whether they can log in)

#### Safety Rules

To prevent mistakes, the system enforces several rules:

- **You cannot change your own account.** This prevents you from accidentally locking yourself out.
- **The primary Admin account cannot be changed by anyone** — not even the Admin themselves. This guarantees there is always someone who can access the system.
- **Temp Admins cannot change the Admin account.** They have many powers, but not over the primary administrator.
- **Only Wamocon team members can be promoted to Temp Admin.** Customer company users cannot receive this role.

---

### 2.4 User Roles — Who Can Do What

The platform now has four roles instead of two. Here is how they work:

| Role | Who Is This? | How Do They Get This Role? | What Can They Do? |
|---|---|---|---|
| **Admin** | One specific person at Wamocon | Automatically assigned based on a system setting. Cannot be changed by anyone. | Everything. Full control over the entire platform, including the ability to promote and demote Temp Admins. |
| **Temp Admin** | Selected Wamocon team members | Promoted by the Admin or another Temp Admin | Almost everything the Admin can do — manage all companies and users, edit all content. Cannot change the Admin. |
| **Trainer** | A trainer at any company | Created by an Admin or Temp Admin | Manage their company's trainees, review work, grade exams. Wamocon trainers can also edit learning content. |
| **Trainee** | A learner at any company | Created by an Admin or Temp Admin | Access learning materials, submit work, take quizzes. Must be activated by a trainer before their first login. |

#### Who Can Change Roles?

| What You Want to Do | Who Can Do It |
|---|---|
| Make a Wamocon trainer into a Temp Admin | Admin or Temp Admin |
| Change a Temp Admin back to a regular trainer | Admin or Temp Admin |
| Change the Admin | Nobody — this role is permanent |
| Create a new Admin | Nobody — there can only be one |

#### The Admin Safety Net

The Admin role is permanently tied to one email address. Even if someone were to change it directly in the database, the system would automatically fix it on the next login. This guarantees there is always one person who can access and manage the platform, no matter what.

---

### 2.5 How a New Trainee Gets Access

Getting a new trainee onto the platform is a two-step process:

1. **A Wamocon administrator creates the account** and assigns it to a company.
2. **A trainer at that company activates the trainee.** Until then, the trainee cannot log in.

This gives trainers control over when their trainees start using the platform.

#### Step by Step

1. An Admin or Temp Admin creates the trainee account in User Management.
2. The trainee account exists but is **not yet activated**.
3. The trainers at that company get a **notification** that someone new is waiting.
4. A trainer goes to their Trainees page and clicks **Activate**.
5. The trainee can now log in and start learning.

#### Pausing a Trainee's Access

Trainers can also **deactivate** a trainee at any time. The trainee cannot log in until they are reactivated. This is useful when you want to temporarily pause someone's access without removing their account.

| Role | Can They Activate or Deactivate Trainees? |
|---|---|
| Admin | Yes — any trainee at any company |
| Temp Admin | Yes — any trainee at any company |
| Trainer | Yes — but only trainees at their own company |
| Trainee | No |

---

### 2.6 Light Plan vs. Pro Plan — What Each Company Gets

Each company is assigned a plan that controls which premium features they can use. Both plans offer the **same full platform experience** — the only differences are about Wamocon-provided PDF documents and the AI assistant.

| Feature | Light Plan | Pro Plan |
|---|---|---|
| All learning content (courses, lessons, quizzes, use cases) | Yes | Yes |
| Submit work, get graded, take exams | Yes | Yes |
| Weekly training reports (evidence of training) | Yes | Yes |
| School calendar, exams, and notes | Yes | Yes |
| Trainers uploading their own PDF documents | Yes | Yes |
| Trainees can view and download PDFs uploaded by their own trainer | Yes | Yes |
| **Wamocon-provided PDF documents (theory and scenario PDFs)** | **Not included** — the description contains book references instead. Trainers can upload their own replacement PDFs for their company. | **Included** — Wamocon's PDFs are provided and visible to all users. Nobody except Wamocon can change or delete these PDFs. |
| **HAI AI Learning Assistant** | **Not available** — the assistant is hidden | **Full access** |

#### What It Looks Like in Practice

- **Pro plan:** Trainees and trainers see all PDFs — both Wamocon-provided documents and any additional PDFs their own trainer has uploaded. In the content management view, trainers can see Wamocon's PDFs (read-only, no delete) and can also upload their own. The HAI AI assistant is available.
- **Light plan:** Trainees and trainers do **not** see Wamocon-provided PDFs. Instead, the enabler description contains book references (title, author, page) so learners can find the material in physical books. Trainers can upload their own PDFs, and trainees in the same company can see and access those. The HAI AI assistant is hidden.

#### Everything Else Is Identical

Apart from the two differences above (Wamocon PDFs and HAI), Light and Pro plan users have exactly the same experience. All courses, quizzes, use cases, submissions, grading, school features, reports, and platform functionality work identically on both plans.

---

### 2.7 Who Can Edit Learning Content

There are two kinds of content on the platform, and the rules for who can change them are different.

#### Learning Content (Managed by Wamocon)

This includes all courses, lessons, use cases, quizzes, questions, and learning fields. This is the core curriculum that every company shares.

| What You Want to Do | Who Can Do It |
|---|---|
| View and use the content | Everyone at every company |
| Create, change, or delete it | Only Wamocon team members |

Customer company trainers **cannot** change learning content. They use it as-is for their trainees.

#### Wamocon-Provided PDFs (Theory and Scenario Documents)

Wamocon provides PDF documents (theory materials and scenario exercises) as part of the core curriculum. These are **only visible to Pro plan companies**. Light plan companies do not see these PDFs — instead, book references are provided in the enabler descriptions.

| What You Want to Do | Who Can Do It |
|---|---|
| View and download | Pro plan users (all roles) |
| Create, change, or delete | Only Wamocon team members |

**Pro plan trainers** can see Wamocon's PDFs in the content management view, but they **cannot delete or modify** them. Only Wamocon's own trainers can manage these documents.

#### Company-Specific Documents (Uploaded PDFs)

Trainers at any company can upload their own PDF documents to add to the learning materials. These documents **belong to that company only**.

| What You Want to Do | Who Can Do It |
|---|---|
| Upload a PDF | Any trainer (for their own company) |
| View or download it | Only people at the same company, plus Wamocon administrators |
| Delete it | The trainer who uploaded it, or any Wamocon administrator |

**Important:** No company can see another company's uploaded documents. A PDF uploaded by Company A is invisible to Company B. This applies to both Light and Pro plan companies.

---

### 2.8 Language Support — German and English

The entire platform now works in both **German** and **English**. This includes every page, every button, every message, and every notification.

#### How to Switch Languages

- Click the **language icon** in the top-right corner of the screen (visible on every page).
- The platform instantly switches to the other language.
- Your choice is remembered — the next time you log in, it will be in the language you last used.

#### Where It Works

- All navigation menus and sidebar items
- All page titles, descriptions, and labels
- All buttons, form fields, and error messages
- All confirmation dialogs and notification messages
- The login page, registration page, and password reset page
- Admin panels (User Management, Organization Management)
- The HAI AI assistant interface

The platform is set to **German by default** and can be switched to English at any time.

---

### 2.9 Getting Started Tour for New Users

When someone logs in for the first time, they see a **guided tour** that walks them through the platform step by step.

#### How It Works

- A spotlight highlights each important part of the platform, one at a time.
- A short description explains what each section does.
- The user can click "Next" to continue, "Back" to go back, or "Skip" to close the tour.
- The tour is **different for trainers and trainees** — each person sees only the features relevant to their role.
- After the main tour, a second mini-tour introduces the **HAI AI assistant** (for Pro plan users).

#### Topics Covered in the Tour

**For Trainees:** Dashboard, Courses, Quizzes, Activity Reports, Trainer Feedback, Notifications, Settings, and HAI.

**For Trainers:** Dashboard, Content Management, Quiz Management, Trainees, Activity Reports, Notifications, Settings, and HAI.

#### Seeing the Tour Again

If you want to see the tour again, go to your **Profile** page and click **"Restart Tour"**.

---

### 2.10 Deleting Users and Organizations

Administrators can permanently delete users and organizations when they are no longer needed.

#### Deleting a User

- Click the **trash icon** next to the user in the User Management table.
- A confirmation dialog appears asking if you are sure.
- The user's account and all their login credentials are permanently removed.

**Safety rules for deleting users:**
- You **cannot delete yourself**.
- The **primary Admin account cannot be deleted** by anyone.
- A **Temp Admin cannot delete an Admin** account.

#### Deleting an Organization

- Click the **Delete** button on the organization card.
- A confirmation dialog appears asking if you are sure.
- The organization is permanently removed.

**Safety rules for deleting organizations:**
- The **Wamocon (platform owner) organization cannot be deleted**.
- An organization **cannot be deleted if it still has users assigned** to it. You must first move or delete those users.

**Note:** Deleting is permanent and cannot be undone. If you only need to temporarily block access, use the **Activate/Deactivate** feature instead — it pauses access without removing anything.

---

### 2.11 Changes to Pages You Already Know

Several pages that existed before this update have been adjusted:

| Page | What Changed |
|---|---|
| **Login page** | Now checks if the company is active, if the user is active, and if the trainee has been approved by a trainer. Shows clear messages explaining why access is denied. |
| **Registration page** | No longer open to the public. All accounts are now created by Wamocon administrators through User Management. The page now shows a message saying "Your account is created by your administrator." |
| **Trainer — Trainees page** | Added Activate/Deactivate buttons for each trainee. Shows a banner when there are trainees waiting for activation. |
| **Trainer — Content Management** | Visible to all trainers. Customer company trainers can view content and manage their own PDFs. Only the Wamocon team can create, edit, or delete learning content. |
| **Trainer — Quiz Management** | Visible to all trainers. Customer company trainers can view quizzes. Only the Wamocon team can create, edit, or delete quizzes. |
| **Trainee — Enabler Page** | For Light plan companies, Wamocon-provided PDFs are not shown. Only PDFs uploaded by the company's own trainer are visible. Book references are provided in the description instead. |
| **Trainer — Content Management (PDFs)** | For Light plan trainers, Wamocon-provided PDFs are not shown in the Theorie-PDFs and Szenario-PDFs sections — they start empty. Trainers can upload their own. For Pro plan trainers, Wamocon PDFs are shown read-only (cannot be deleted). |
| **HAI AI Assistant** | Hidden entirely for Light plan companies. |
| **Sidebar — User Profile Section** | Now shows the user's role (Admin, Temp Admin, Trainer, or Trainee) in their preferred language. |
| **All trainer pages** | Now show only data from the trainer's own company. A trainer at Company A only sees Company A's trainees, submissions, and reports — never Company B's. |
| **Birthdate prompt** | Trainees are now required to enter their birthdate before they can access any content. A full-screen prompt appears until this information is provided. |
| **All pages** | Every piece of text on the platform is now available in both German and English, switchable at any time from the top-right language button. |

---

## 3. How Your Data Is Protected

### 3.1 Three Layers of Protection

Your data is protected by three independent safety layers. Even if one layer were to fail, the others would still keep everything secure.

| Layer | What It Does |
|---|---|
| **Layer 1 — The Application** | Every action checks who you are, which company you belong to, and what your plan allows before doing anything. |
| **Layer 2 — Access Checks** | Before any page loads, the system runs a series of checks: Is the company active? Is the user active? Is the trainee approved? Are there seats available? |
| **Layer 3 — Database Protection** | The database itself has built-in rules about who can see which data. This is the deepest level of protection and works independently of the rest of the system. |

### 3.2 How We Keep Each Company's Data Separate

The database has built-in rules (called "Row-Level Security") that automatically filter data based on who is asking for it.

**Think of it like a building with locked floors.** Each company has its own floor, and the elevator checks your keycard before letting you off. Even if someone managed to trick the receptionist, the elevator would still refuse to take them to the wrong floor.

Every time anyone requests data:

- **Regular users** (trainers, trainees) only see data from their own company.
- **Wamocon administrators** can see data from all companies (they manage the platform).
- **Shared learning content** (courses, quizzes) is visible to everyone but can only be changed by Wamocon.

This filtering happens automatically on every single request. It cannot be turned off or bypassed.

#### Real-World Examples

| What Happens | Result |
|---|---|
| A trainer at Company A tries to see Company B's trainees | Nothing is shown. Company B's data is invisible to them. |
| A trainee tries to access another company's documents | Blocked. The document is not returned. |
| A Wamocon administrator looks at a customer company's data | Allowed — Wamocon manages the platform for all companies. |
| A Light plan user opens an enabler page | Wamocon-provided PDFs are not shown. They see only PDFs uploaded by their own company's trainer. |

### 3.3 What Stays Private, What Is Shared

**Private to each company** (no other company can see this):

- Trainee profiles and personal information
- All submitted work and trainer reviews
- Quiz attempts and results
- Weekly training reports (evidence of training)
- School calendar, exams, and exam results
- Work certificates and performance evaluations
- PDF documents uploaded by the company's trainers
- HAI AI assistant conversations
- Personal notes
- Notifications

**Shared across all companies** (everyone can read, only Wamocon can change):

- Courses and their structure
- Lessons and their descriptions
- Use cases
- Quizzes and questions
- Learning fields (Lernfelder)
- Platform-provided documents

### 3.4 What Happens When Someone Tries to Log In

Every time someone logs in, the system runs through a checklist. If any check fails, the person is told exactly why they cannot access the platform.

| Check | What It Looks For | Message If It Fails |
|---|---|---|
| 1 | Is the **company** active? | "Your organization is inactive. Please contact your administrator." |
| 2 | Is the **user account** active? | "Your account has been deactivated. Please contact your administrator." |
| 3 | For trainees: has a **trainer approved** them? | "Your account is pending trainer approval. Please contact your trainer." |
| 4 | Has the company reached its **maximum number of accounts**? | "Your organization has reached its maximum number of seats." |

The **Admin account** skips all these checks. This means even if every company and every user were deactivated, the Admin could still log in and fix the situation.

### 3.5 How We Prevent Accidental Data Loss

| Protection | How It Works |
|---|---|
| **Deactivation instead of deletion** | The main way to remove access is by deactivating, not deleting. All data stays safe and can be restored instantly by reactivating. |
| **Delete confirmations** | When you do want to permanently delete a user or organization, a confirmation dialog always asks "Are you sure?" before proceeding. |
| **Cannot delete the Admin** | The primary Admin account cannot be deleted, ensuring permanent platform access. |
| **Cannot delete the platform owner** | The Wamocon organization cannot be deleted through the platform. |
| **Cannot delete companies with users** | An organization can only be deleted after all its users have been removed or reassigned. |
| **Cannot edit yourself** | Administrators cannot change their own account, preventing accidental lockouts. |
| **Nothing is lost when deactivating** | Turning a company off does not delete any data. All submissions, grades, reports, and documents remain exactly as they were. When the company is turned back on, everything is still there. |

### 3.6 Was Any Existing Data Affected by This Update?

**No.** The upgrade was carried out without deleting, changing, or risking any existing data. Here is what happened:

1. **No data was deleted.** Every existing user, submission, grade, document, course, and quiz is still there.
2. **No data was changed.** All existing information stays exactly as it was. We only added new information (like which company each user belongs to).
3. **All existing users were kept.** Every existing account was assigned to the Wamocon organization and marked as active, so nobody lost access.
4. **All existing content was kept.** Every course, lesson, quiz, and learning material remains available.
5. **All existing documents were kept.** Previously uploaded documents are now classified as Wamocon content and are accessible to Pro plan companies.
6. **We only added, never removed.** New features and capabilities were built on top of what already existed. Nothing was taken away.

**In short: everything that worked before still works. We only added new capabilities.**

---

## 4. Before and After — A Quick Comparison

| Area | How It Was Before | How It Is Now |
|---|---|---|
| Companies | The platform served one company | Multiple companies, each with their own private data |
| User Roles | Trainer and Trainee only | Admin, Temp Admin, Trainer, and Trainee |
| Creating accounts | People registered themselves | Wamocon creates all accounts and sends login details |
| Trainee access | Immediate after registration | Requires approval from a trainer first |
| Editing learning content | Any trainer could edit | Only the Wamocon team can edit |
| Documents | Everyone could see all documents | Each company's documents are private. Pro plan includes Wamocon-provided PDFs; Light plan relies on book references and trainer-uploaded PDFs |
| AI Assistant (HAI) | Available to everyone | Available only to Pro plan companies |
| Data protection | Application-level checks only | Application + database-level protection with built-in rules |
| Company control | Not possible | Turn entire companies on or off instantly |
| User control | Based on email lists | Individual control with role management and activation |
| Deleting accounts | Not available | Administrators can delete users and organizations with safety checks |
| Languages | Partially translated | Fully available in German and English |
| New user guidance | None | Guided tour on first login, with restart option |

---

## 5. Key Terms Explained

| Term | What It Means |
|---|---|
| **Organization** | A company using the LFA platform. Each organization has its own trainers, trainees, and data. |
| **Platform Owner** | Wamocon — the company that runs the platform and manages all content and all other organizations. |
| **Subscription Plan** | The feature level a company has purchased. Light gives core features; Pro adds document downloads and the AI assistant. |
| **Trainer Activation** | The step where a trainer approves a new trainee's account, allowing the trainee to log in for the first time. |
| **Seat Limit** | The maximum number of accounts (trainer or trainee) a company has purchased. The system prevents creating more than this number. |
| **Learning Content** | The courses, lessons, quizzes, and learning materials managed by Wamocon and shared with all companies. |
| **Company Documents** | PDF files uploaded by a company's trainers. These are private to that company and invisible to others. |
| **Access Checks** | The series of verifications the system runs before letting someone log in or perform an action. |
| **HAI** | The AI-powered learning assistant built into the platform. Available to Pro plan companies. |
| **Data Isolation** | The guarantee that each company's data is kept completely separate from every other company's data. |
| **Deactivation** | Temporarily blocking access for a user or company without deleting any data. Can be reversed at any time. |

---

*This document describes the LFA Platform as of March 2026.*

*© 2026 WAMOCON GmbH. All rights reserved.*
