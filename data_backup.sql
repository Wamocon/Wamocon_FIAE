SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict uIdyzIe8CYSE8QKWrhfgqaAj3WbUszHJUnN2S74foSsQqQbpw2Od6HZ7LgVrYiH

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."audit_log_entries" ("instance_id", "id", "payload", "created_at", "ip_address") VALUES
	('00000000-0000-0000-0000-000000000000', '5986df3a-227e-45a8-880a-186d10770efc', '{"action":"user_signedup","actor_id":"0bd3aec2-d92d-477d-8031-56c327892caa","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2025-10-21 08:28:29.279786+00', ''),
	('00000000-0000-0000-0000-000000000000', '45d2ec4e-c826-4c4c-ba36-e4bfc8e4b0c4', '{"action":"login","actor_id":"0bd3aec2-d92d-477d-8031-56c327892caa","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-21 08:28:29.28499+00', ''),
	('00000000-0000-0000-0000-000000000000', '41b5ec76-85bc-478e-8f7c-21693888c7b2', '{"action":"login","actor_id":"0bd3aec2-d92d-477d-8031-56c327892caa","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-21 08:29:35.541233+00', ''),
	('00000000-0000-0000-0000-000000000000', '28345005-06cd-4cda-b32c-560e23988d83', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"yash.bhesaniya@wamocon.com","user_id":"0bd3aec2-d92d-477d-8031-56c327892caa","user_phone":""}}', '2025-10-21 08:31:15.93619+00', ''),
	('00000000-0000-0000-0000-000000000000', '53da38aa-5d1e-4922-8faa-3562db07d8fb', '{"action":"user_signedup","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2025-10-21 08:31:50.793461+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a30e10c6-a723-4d2f-844a-52a46142f7a1', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-21 08:31:50.796256+00', ''),
	('00000000-0000-0000-0000-000000000000', 'da5681d8-6351-4cfd-b874-1bf0f662fbd0', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-21 08:34:15.891108+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a04a90a3-1f8c-4ad6-9535-95c51e839024', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-21 08:35:49.312349+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd2eb4363-dc18-4f32-a57b-9f69648f35d4', '{"action":"user_signedup","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2025-10-21 08:43:13.541329+00', ''),
	('00000000-0000-0000-0000-000000000000', '3488cc80-9379-4169-9ee0-88977c8278c7', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-21 08:43:13.544855+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dbca7153-712f-4ff3-81c6-2104f3cd53b9', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-21 08:46:57.06976+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a8e2066e-da7a-46f4-a085-37ca20bb1f87', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-22 08:36:31.40602+00', ''),
	('00000000-0000-0000-0000-000000000000', '3c13693d-9a4d-4c0e-b122-c73dae123a40', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-22 08:36:31.409989+00', ''),
	('00000000-0000-0000-0000-000000000000', '014c45f3-2e42-4745-8b57-c5eafaf352c8', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-22 08:36:40.573004+00', ''),
	('00000000-0000-0000-0000-000000000000', '55ef579f-4a72-49c5-a481-ce273dffbfb4', '{"action":"user_repeated_signup","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-10-22 08:37:38.458962+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e7409d55-d69c-419d-9609-b0407b96a003', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-22 08:37:58.947611+00', ''),
	('00000000-0000-0000-0000-000000000000', 'da858d09-0d34-482f-85e9-67b62aea6573', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-22 08:56:21.085226+00', ''),
	('00000000-0000-0000-0000-000000000000', '0637a404-8e7b-4e52-bf9d-28ea905dc0d5', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-22 08:56:27.641859+00', ''),
	('00000000-0000-0000-0000-000000000000', '33b97552-dc75-47e4-bb96-43b885012d37', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-22 08:57:47.530908+00', ''),
	('00000000-0000-0000-0000-000000000000', '7fe48d11-ba60-4fde-8f5a-33ded47dd1ea', '{"action":"user_repeated_signup","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-10-22 09:18:05.000709+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f06da85c-52b6-418b-8d06-c3b2553a7c84', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-22 09:18:25.311671+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ebceffff-5fa4-4add-8ad5-52ba42b50c5d', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-22 09:56:10.96695+00', ''),
	('00000000-0000-0000-0000-000000000000', '6308b096-9abd-4852-8d99-3c94366a1ec8', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-22 09:56:10.978432+00', ''),
	('00000000-0000-0000-0000-000000000000', '2743cf83-d807-4fee-9124-8663b4a3dedd', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-22 10:54:10.913589+00', ''),
	('00000000-0000-0000-0000-000000000000', '00bf8fba-57ef-4c92-bbd9-cd3b30d21b8b', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-22 10:54:10.919793+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ffb3959d-9085-4a4f-86f2-d5ff00d8f106', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 07:25:59.708026+00', ''),
	('00000000-0000-0000-0000-000000000000', '8bc4f9ec-ef7e-4932-9a7a-dfdffe99b559', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 08:24:52.708338+00', ''),
	('00000000-0000-0000-0000-000000000000', '93a515ad-1518-48d0-9652-02e8acfd9573', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 08:24:52.711995+00', ''),
	('00000000-0000-0000-0000-000000000000', '32500b4a-1221-4a4f-9387-42345e85b281', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-24 08:49:41.078002+00', ''),
	('00000000-0000-0000-0000-000000000000', '9b897a4f-7aa5-451d-8926-5c53d1c1c5aa', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 08:50:02.331673+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bac5b640-6bdd-4607-a0b4-1d8321b18635', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 08:50:07.880873+00', ''),
	('00000000-0000-0000-0000-000000000000', 'cf8c98a6-a221-4fe8-816f-7390cce877fc', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 10:55:20.050614+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ad3130ce-f1a9-446b-ab71-03959f955d85', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 10:55:20.067043+00', ''),
	('00000000-0000-0000-0000-000000000000', '976b7815-2097-476d-8126-85236f1de5ea', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 11:05:04.623771+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c2cf95ad-eb4e-43aa-adeb-688e0bfab614', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 12:03:13.852015+00', ''),
	('00000000-0000-0000-0000-000000000000', '4032297c-f08e-40e2-a576-02fd8b1cf612', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 12:03:13.859054+00', ''),
	('00000000-0000-0000-0000-000000000000', '599580eb-0789-44a3-8518-bcdb481bea47', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 13:01:24.105405+00', ''),
	('00000000-0000-0000-0000-000000000000', '29b8933c-1eed-46c5-bb31-6381f6eba34f', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-24 13:01:24.1096+00', ''),
	('00000000-0000-0000-0000-000000000000', '0d8743a2-79a5-4d65-b0c2-38029a0b8cfb', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-24 13:32:17.376451+00', ''),
	('00000000-0000-0000-0000-000000000000', '42931bda-c869-418b-a30b-21bfdf5a776c', '{"action":"user_signedup","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2025-10-24 13:33:03.020232+00', ''),
	('00000000-0000-0000-0000-000000000000', '56d8b349-19fb-4524-a5d2-bb826b2a0737', '{"action":"login","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 13:33:03.030087+00', ''),
	('00000000-0000-0000-0000-000000000000', '70abceda-a90b-4fb1-92d9-03fc7fa81f28', '{"action":"login","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 13:35:49.554661+00', ''),
	('00000000-0000-0000-0000-000000000000', '29943f58-cf0b-4d7d-9fdb-d29f6ed5658f', '{"action":"logout","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-24 13:36:52.303293+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd470f852-81a7-4d23-ad53-05e60ff748ec', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 13:36:59.811056+00', ''),
	('00000000-0000-0000-0000-000000000000', '241690c5-2f62-4eb9-bfa1-321d38ec8e71', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-24 13:37:48.601054+00', ''),
	('00000000-0000-0000-0000-000000000000', '9a74ac26-cfec-423a-a6e4-4ecfba40d031', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 13:37:55.320781+00', ''),
	('00000000-0000-0000-0000-000000000000', '2fbf2fa1-fa57-44f1-b9f3-016a03f0bc4e', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-24 14:30:17.927512+00', ''),
	('00000000-0000-0000-0000-000000000000', '81295abb-f195-4386-b51f-40ab4e703298', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 14:30:29.100281+00', ''),
	('00000000-0000-0000-0000-000000000000', '82d90f03-ef1b-487f-960c-00e76841b459', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-24 14:59:21.691405+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c11bd230-049d-4388-94fa-c0270d91dc8f', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 14:59:28.646109+00', ''),
	('00000000-0000-0000-0000-000000000000', '7aca5472-9809-4d8b-883b-d5ba7e2685d0', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 14:59:32.431022+00', ''),
	('00000000-0000-0000-0000-000000000000', '210a4c94-459d-48c3-b8e6-c57ed6eefafc', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 14:59:32.838277+00', ''),
	('00000000-0000-0000-0000-000000000000', '4c896fc8-c2df-4222-a0e2-127a3ec23a07', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 14:59:35.023136+00', ''),
	('00000000-0000-0000-0000-000000000000', '3d9d525a-8ac0-4c81-bdc1-c30856c8dd5c', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-24 15:02:20.864287+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f6c4690b-95cf-4797-b546-4d8221d38259', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 08:38:39.003749+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ea40934d-a053-480c-a318-ce94ac65f340', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 08:44:18.477781+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a092979b-2457-40c6-8e2e-81e1fe0207f4', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-27 08:44:59.169914+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ac251960-7e4c-448e-b18c-30dea50226eb', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 08:45:06.190655+00', ''),
	('00000000-0000-0000-0000-000000000000', '0fb9001a-cc2c-4811-9204-ede82a76fbbf', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-27 09:37:59.669232+00', ''),
	('00000000-0000-0000-0000-000000000000', '11c058c6-4c90-418a-8452-94f98eed5bfe', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 09:38:11.090781+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd5dd2d49-142c-4d33-810f-05d547ee5872', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 09:38:16.626718+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c1c4d627-9389-47ac-b996-6e1c9f967409', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 09:38:23.165542+00', ''),
	('00000000-0000-0000-0000-000000000000', '1be42aab-4ae7-412a-a4e8-af4cdc154960', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 09:51:05.743034+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a86981e5-c4cf-462b-8d50-7fc25045dc3b', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 10:40:54.515372+00', ''),
	('00000000-0000-0000-0000-000000000000', '63aa9fb6-fb43-47b8-a963-a58cdfaeded6', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 10:40:54.519226+00', ''),
	('00000000-0000-0000-0000-000000000000', '47fb67d8-e354-4097-82f6-659372eb10f0', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 11:57:28.331726+00', ''),
	('00000000-0000-0000-0000-000000000000', '3c1d2e7a-e914-4ee1-8381-ba76ef971fd7', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 11:57:28.338634+00', ''),
	('00000000-0000-0000-0000-000000000000', '6e229274-e216-4b1d-95e6-d00f7b731b86', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 12:04:49.998711+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f94cca92-5165-4163-88c9-95d471d1e9bc', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 12:04:50.000824+00', ''),
	('00000000-0000-0000-0000-000000000000', '5763cf83-7c2b-4462-ba2e-3cde05c92d97', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 12:55:48.692002+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e3e2cc43-58da-4354-b1a4-2a48c27b47dc', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 12:55:48.695671+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd26ae6ac-74f2-428b-9f76-9d3560b616f6', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 13:34:05.494577+00', ''),
	('00000000-0000-0000-0000-000000000000', '58f88cfe-529e-4c28-b8d7-704655d4794a', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 13:34:05.498205+00', ''),
	('00000000-0000-0000-0000-000000000000', '8b0f9cdb-1995-48ce-8478-82ad0eca9d91', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 14:10:34.483589+00', ''),
	('00000000-0000-0000-0000-000000000000', '7caf07e2-ce4e-4fc7-9868-1b75d3a50412', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 14:10:34.4913+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dd1279a9-d0af-4389-9e2a-3d2e03e4bfbb', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 14:32:37.348641+00', ''),
	('00000000-0000-0000-0000-000000000000', '2db02e1d-1717-4b4d-8871-09ae7c80aa92', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 14:32:37.355057+00', ''),
	('00000000-0000-0000-0000-000000000000', '53ee6fbd-f288-4d70-ba2f-0ceda8375e11', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 14:55:23.21642+00', ''),
	('00000000-0000-0000-0000-000000000000', '65ee9ce5-1742-48fe-963c-1b7c584d5a36', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 14:55:39.723035+00', ''),
	('00000000-0000-0000-0000-000000000000', '0780924d-924d-4fe6-b250-4ab0a4e83b97', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 14:55:56.010433+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f1a7f66e-b2f2-4e97-a619-68026ac8dff7', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 14:56:03.532291+00', ''),
	('00000000-0000-0000-0000-000000000000', '94a84d00-6a9c-46b3-896c-3ae3c618b44d', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 14:56:54.196076+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ef93310f-d54e-46e9-b916-5279064b24b1', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 15:05:26.396651+00', ''),
	('00000000-0000-0000-0000-000000000000', '84a186d9-69da-4970-b133-c1811dcc2168', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-27 15:09:43.181005+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f29719a8-e585-437f-93ea-b11429c98788', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-27 15:09:54.018779+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b9c7cf1c-7085-4d7f-84ce-066e189f7dab', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 16:08:18.116418+00', ''),
	('00000000-0000-0000-0000-000000000000', '4e3d282c-f331-4dab-90ba-4ae17f582df5', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-27 16:08:18.124852+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd2b0e07c-b93e-4e47-ad71-4f296b1d8aa4', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 08:12:04.091508+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f2fa5e67-c83b-4858-a8fd-8e3e5efda984', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 08:12:04.098764+00', ''),
	('00000000-0000-0000-0000-000000000000', '8b188388-885c-4ecb-b820-ea12fa65ce0d', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-28 09:09:08.495175+00', ''),
	('00000000-0000-0000-0000-000000000000', '46fcea64-8f9a-4349-b8ae-3f9d0cc970b1', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:09:15.098822+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a14ddcc4-d707-47a5-8d3e-591a5321c2dc', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:09:19.257519+00', ''),
	('00000000-0000-0000-0000-000000000000', '1956bc92-39a8-4176-8fd3-635b15ce706f', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:09:20.06217+00', ''),
	('00000000-0000-0000-0000-000000000000', '5c745380-9928-4591-a2b3-f5e120075036', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:09:20.59861+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c1e68edd-d9a8-4e71-8150-8e85b3bdb6f2', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:09:21.094319+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fbe950b9-1200-49a1-a172-8b12ba59f186', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:09:21.309138+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b23f2911-d79c-4259-a540-3d40853f16aa', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-28 09:42:52.661837+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bebecf04-3245-4a03-b0f8-8d19b4c3dc35', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 10:13:55.551552+00', ''),
	('00000000-0000-0000-0000-000000000000', '57269082-1a6e-47c5-99de-90993cb43aa3', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 10:13:55.554076+00', ''),
	('00000000-0000-0000-0000-000000000000', '7c57186e-4588-4540-9c64-e2fc1c297080', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 10:41:28.69437+00', ''),
	('00000000-0000-0000-0000-000000000000', '9d234a6a-7fbe-4bc2-a928-5c547f13f3ab', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 10:41:28.703811+00', ''),
	('00000000-0000-0000-0000-000000000000', '2dddc273-af62-40df-94cc-9a418e2fc39e', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 11:59:39.23732+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b549133d-819b-4fe6-a03b-bf539a0bd526', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 11:59:39.24171+00', ''),
	('00000000-0000-0000-0000-000000000000', '66be6a9c-0953-4a76-b28b-caca39da25e8', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 12:00:57.594751+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b374825a-fab9-4f84-a340-c82bc2837f78', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 12:00:57.597707+00', ''),
	('00000000-0000-0000-0000-000000000000', '3311ce6b-a02b-407a-9f19-74b75dca885c', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 12:58:19.315321+00', ''),
	('00000000-0000-0000-0000-000000000000', '311baedb-dd63-4dd3-860e-6719ce0b80bc', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 12:58:19.322944+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ec9a67e1-734d-463b-aec6-5f2ecbb62426', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 15:19:04.247428+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e2658af2-f472-417e-9005-b5dc60f25275', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 15:19:04.257237+00', ''),
	('00000000-0000-0000-0000-000000000000', '6d3b46b9-39a7-4879-9c0d-7130efd4cdbe', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 15:44:07.01775+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a79bdd62-abfc-4a51-8da7-44c6ab5cf330', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 15:44:07.02277+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dfe40647-90fd-465e-89b0-7e949df67df3', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 16:42:12.816915+00', ''),
	('00000000-0000-0000-0000-000000000000', '16457168-cd17-4793-8af4-fab7e4f3f3be', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 16:42:12.822189+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ece9827d-f4c9-4000-9f1e-3ee839c58de5', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 16:42:46.427827+00', ''),
	('00000000-0000-0000-0000-000000000000', '9d7f8d2a-159b-4116-8a0d-aeaa77fb8776', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-28 16:42:46.42899+00', ''),
	('00000000-0000-0000-0000-000000000000', '8f631b65-e830-4873-bdff-b5acf661fdc1', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 08:15:19.143091+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e7ff2798-30ab-4ac5-a59e-3c06c323bc6d', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 08:15:19.149513+00', ''),
	('00000000-0000-0000-0000-000000000000', '119e3055-8ce3-4cc3-921c-44e08a15eb23', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 08:15:46.791362+00', ''),
	('00000000-0000-0000-0000-000000000000', '9b4e6503-8847-408c-87e4-aa6535606265', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 08:15:46.792977+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c277d721-fd4e-4544-b2ad-98ae022ef8a5', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 09:14:00.919928+00', ''),
	('00000000-0000-0000-0000-000000000000', '28c5cf08-14a7-449c-9cab-16f87b8b5d78', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 09:14:00.926758+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b1df391a-b84e-448b-8053-09613f005659', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 09:14:15.439305+00', ''),
	('00000000-0000-0000-0000-000000000000', '4bbe217c-16dc-4307-95f4-8d6b734541ba', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 09:14:15.44137+00', ''),
	('00000000-0000-0000-0000-000000000000', '15f84dbc-19f6-4d22-8a6a-dbc627360beb', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 10:12:01.180433+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ea1c2e7e-8b54-4e52-aced-855b0aca2608', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 10:12:01.188264+00', ''),
	('00000000-0000-0000-0000-000000000000', '47d477d0-a7db-43e2-979f-6da1db35eced', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 10:13:24.313388+00', ''),
	('00000000-0000-0000-0000-000000000000', '61e9032a-d28a-4545-8f2a-db8f1d7ba997', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 10:13:24.31595+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b0909994-c55b-4a9f-a50b-df425c1745c5', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 11:33:11.848265+00', ''),
	('00000000-0000-0000-0000-000000000000', '5fb50fff-a122-4c16-a940-c3cb0cf80bdf', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 11:33:11.882373+00', ''),
	('00000000-0000-0000-0000-000000000000', '36b7d3d6-cfea-4f44-ad38-ef4ce6a49a71', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 11:48:40.083423+00', ''),
	('00000000-0000-0000-0000-000000000000', '308a6871-1ca7-48ab-a52b-25aad79ec036', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 11:48:40.096749+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f15223dc-d70d-4dc5-9fcb-43ac98e819b1', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 12:37:51.924304+00', ''),
	('00000000-0000-0000-0000-000000000000', '05d989a1-be9f-4f6a-8949-ff075b512935', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 12:37:51.94731+00', ''),
	('00000000-0000-0000-0000-000000000000', '041ceeef-0ef3-499a-a746-60b8d2bd37ba', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 12:46:55.478279+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c38e2d3c-0b7d-4256-8f3b-48c2a1726ace', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 12:46:55.484179+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a0b92c00-4765-4ece-ba2b-28cd971041a3', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-29 13:00:02.616884+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dfd6fe79-5167-472e-91a4-b41bdfb1c8c4', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-29 13:06:02.320322+00', ''),
	('00000000-0000-0000-0000-000000000000', '9ae7fd0e-f38b-446d-b7b8-5e8a6b5b61f9', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 13:50:17.04486+00', ''),
	('00000000-0000-0000-0000-000000000000', '8d5f7d1f-9de4-4f57-97b7-7e97445b3156', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 13:50:17.056041+00', ''),
	('00000000-0000-0000-0000-000000000000', '28d4f40b-d549-4d7c-b846-9b97897e5f99', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 14:04:25.074722+00', ''),
	('00000000-0000-0000-0000-000000000000', '8a13d456-8f43-4dd9-a864-e233f4e47b06', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 14:04:25.083383+00', ''),
	('00000000-0000-0000-0000-000000000000', '64e4042c-e341-45fb-83b9-952a4826535a', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-10-29 14:05:48.839691+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fbe52421-4feb-4939-a913-e3435b446c55', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-29 14:14:51.863452+00', ''),
	('00000000-0000-0000-0000-000000000000', '69796bdf-7876-4d1e-8b98-c019a6e929ee', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-29 15:00:50.185648+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f310ffe1-2322-4003-89b0-ef27a2d94ff1', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-29 15:24:02.645319+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fb3c5a8d-ac19-4f65-b59d-92761c5a8ce6', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-29 15:25:05.680447+00', ''),
	('00000000-0000-0000-0000-000000000000', '3fde5aea-453c-4c56-bcfa-450e5b052daf', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-29 15:25:35.602098+00', ''),
	('00000000-0000-0000-0000-000000000000', 'aa641354-f21d-41b7-ae56-7e23c5b7b1f6', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 15:58:57.255524+00', ''),
	('00000000-0000-0000-0000-000000000000', '2d61c57f-681c-426c-9a82-9356cab1e84e', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-29 15:58:57.261035+00', ''),
	('00000000-0000-0000-0000-000000000000', '66ccab93-c9f6-4a24-90bc-e753c7c7f855', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-30 14:51:09.242875+00', ''),
	('00000000-0000-0000-0000-000000000000', '106f4d6f-1f84-4dc6-802a-1623b9bf7b84', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-30 15:07:06.403466+00', ''),
	('00000000-0000-0000-0000-000000000000', 'aaac1b74-4fb1-4c3a-89e1-7e844209037a', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 15:49:23.856615+00', ''),
	('00000000-0000-0000-0000-000000000000', '40c519c2-bfc8-4a54-981b-858e4022a916', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 15:49:23.862519+00', ''),
	('00000000-0000-0000-0000-000000000000', '60fd1ff9-cbaf-4761-a937-cdcac30fe455', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 16:15:57.82719+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a9caaa51-ffa3-4816-98e6-da191e1c12cf', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 16:15:57.834924+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fdb929d6-5ce8-4fcb-a612-44983d0500af', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 17:14:21.998083+00', ''),
	('00000000-0000-0000-0000-000000000000', '683d7c3e-cd79-4f91-8fcb-fad04c413e21', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 17:14:22.010038+00', ''),
	('00000000-0000-0000-0000-000000000000', '2cee4158-8a24-4e01-b724-06330b78a9ae', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 17:21:05.951749+00', ''),
	('00000000-0000-0000-0000-000000000000', '10d1aa22-e9d9-4f34-9c38-cc535ac00838', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-30 17:21:05.958829+00', ''),
	('00000000-0000-0000-0000-000000000000', '33ab3dc7-23bf-4a0d-b635-6c5769f3db35', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 07:59:47.29253+00', ''),
	('00000000-0000-0000-0000-000000000000', '9677dc67-644f-4212-852a-6250d001a2f3', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:00:00.353327+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd8f8cfe3-19ff-4662-a7bc-25d6e0cceb2d', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:09:45.463405+00', ''),
	('00000000-0000-0000-0000-000000000000', '3c0082d9-3291-400b-a517-17d4eda3733d', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:09:48.280305+00', ''),
	('00000000-0000-0000-0000-000000000000', '2b7f84d7-e669-4075-a4d9-651bf9fca1b9', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:09:57.638298+00', ''),
	('00000000-0000-0000-0000-000000000000', '91d18527-7eb8-41bf-8b53-c765ed826f73', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:09:59.8272+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bfebbc7d-8157-4b4e-abe2-26cb17472430', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:00.842507+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bb133a7a-6850-47a4-a449-3165f26c45b5', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:01.411178+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e6bfa027-c63f-4571-8463-ab6535b395b9', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:01.708664+00', ''),
	('00000000-0000-0000-0000-000000000000', '5c9cab38-ac8c-493d-8dd3-36799ea0c738', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:04.608825+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bf92e152-5e48-4c27-855c-402a55a58f7a', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:04.997104+00', ''),
	('00000000-0000-0000-0000-000000000000', '6ba5514a-8b87-43f5-971b-21196c48d74a', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:05.18541+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ecc0985a-f022-4682-a021-241dc5412b2e', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:05.405125+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b9ae33a6-781b-457c-a48e-3cb5388d516f', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:05.695557+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b74a2293-f80f-4646-8882-de54828e2013', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:05.964375+00', ''),
	('00000000-0000-0000-0000-000000000000', '2464dda4-6f2c-4489-a50c-6c5ac3753a02', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:06.106155+00', ''),
	('00000000-0000-0000-0000-000000000000', '6cebaeab-dcd7-4c3f-b73e-d4e11e8cdc81', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:06.58118+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ee4d6ab2-e9b5-43ed-9707-36ed79e19eef', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:07.243752+00', ''),
	('00000000-0000-0000-0000-000000000000', '597a07f2-8bfd-45a4-9067-04f7b8e48437', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:10:05.890825+00', ''),
	('00000000-0000-0000-0000-000000000000', '1c247304-c021-49dd-b368-4e169cf73700', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:11:43.540378+00', ''),
	('00000000-0000-0000-0000-000000000000', '898367b2-c6bd-4311-b170-a2b4795af327', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:12:57.165252+00', ''),
	('00000000-0000-0000-0000-000000000000', '0954c624-9abc-4f36-893e-706878bbf6a8', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:12:57.261129+00', ''),
	('00000000-0000-0000-0000-000000000000', 'be56f26f-1106-4d02-b1cf-5c1a7dffd4c1', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:13:00.220229+00', ''),
	('00000000-0000-0000-0000-000000000000', '97eea684-5814-4901-b2db-2cb1c5711dc6', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:13:00.283951+00', ''),
	('00000000-0000-0000-0000-000000000000', '3880f854-11e6-4040-8694-b2a2bbab9029', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:13:10.402253+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bf2a17ad-c8a0-4c65-9fc6-87fc9af23d6b', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:14:17.385189+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a446b0a8-331b-41ec-abae-cfed53ef1258', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:16:00.666201+00', ''),
	('00000000-0000-0000-0000-000000000000', '13a16c00-dc6c-49ad-9743-353a99314069', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:20:00.571928+00', ''),
	('00000000-0000-0000-0000-000000000000', '14d6f234-a898-478f-8df3-603d8cd1c15a', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:20:00.66818+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ea7bca7f-e5ab-47de-8aa0-284c46cb49de', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:20:07.997541+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bea18e75-284b-4d0c-a9eb-dc83064e8c15', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:24:22.791098+00', ''),
	('00000000-0000-0000-0000-000000000000', 'aea4b2f9-67cf-423e-8fc4-673350f5cb4d', '{"action":"login","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:25:52.20241+00', ''),
	('00000000-0000-0000-0000-000000000000', '97dfa83c-535a-4b7c-a902-d540c0945355', '{"action":"logout","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:26:08.128775+00', ''),
	('00000000-0000-0000-0000-000000000000', '965b6b27-df1c-40da-a889-14361bf2d745', '{"action":"login","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:26:24.141536+00', ''),
	('00000000-0000-0000-0000-000000000000', '522d8e35-eee9-4bf2-a77a-ddfbdbd3dc03', '{"action":"logout","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 08:26:40.191349+00', ''),
	('00000000-0000-0000-0000-000000000000', '99c00498-77dc-4175-910b-52245f1b75bc', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 08:27:09.240391+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e49f3ddb-ce74-48ad-b893-8c387f3ddfb8', '{"action":"user_repeated_signup","actor_id":"c4fd8987-87ee-443a-aac7-6e7c0808c26d","actor_username":"123123@gmail.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-10-31 08:37:44.216059+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fdde672b-6937-4cac-b3b1-a9789e26d8d8', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 09:10:10.266681+00', ''),
	('00000000-0000-0000-0000-000000000000', '875e0bd7-73f1-4ccf-8c3c-747ad1893af6', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 09:10:10.270557+00', ''),
	('00000000-0000-0000-0000-000000000000', '8332d526-19ec-4bcc-a3ff-da213e056554', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 09:25:55.44912+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a2a8af8f-c483-4c9f-b4f7-f2c378c3872c', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 09:25:55.455861+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e480bb6f-4737-4a0c-b4ea-b74e16acf12c', '{"action":"logout","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 09:45:32.317178+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd2fe48a0-92f5-4f23-8551-e43c9c5642d2', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 09:45:39.73203+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ac2e6b82-28e3-49ec-8cc3-24b53e108ede', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 10:14:21.367998+00', ''),
	('00000000-0000-0000-0000-000000000000', '777a5a6f-937a-4498-9e9e-c0d21e0d6d00', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 10:14:29.440595+00', ''),
	('00000000-0000-0000-0000-000000000000', 'eef2c682-98ec-4886-ab8d-1baa18b25222', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 10:14:34.393704+00', ''),
	('00000000-0000-0000-0000-000000000000', 'af9e4ca3-5583-4c78-a31d-e448ae50e777', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"9b3a9277-8760-4d7f-8cfe-9ff716107eac","user_phone":""}}', '2025-10-31 10:27:18.610587+00', ''),
	('00000000-0000-0000-0000-000000000000', '40e0fe87-d59f-42ca-af12-048649939339', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"9b3a9277-8760-4d7f-8cfe-9ff716107eac","user_phone":""}}', '2025-10-31 10:27:18.764243+00', ''),
	('00000000-0000-0000-0000-000000000000', '43cef234-520d-43c0-8cc2-fc011a9d324c', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"fe5ae16d-1eff-46c0-a80a-cd9ecc3f0714","user_phone":""}}', '2025-10-31 10:30:26.59004+00', ''),
	('00000000-0000-0000-0000-000000000000', '0dffe934-b1a0-467a-a186-2ec4d9abca24', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"fe5ae16d-1eff-46c0-a80a-cd9ecc3f0714","user_phone":""}}', '2025-10-31 10:30:26.644296+00', ''),
	('00000000-0000-0000-0000-000000000000', '363e889f-c697-4d44-aa44-a0884fefa204', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"8dc747c5-e198-4793-b36b-2efdad4148c5","user_phone":""}}', '2025-10-31 10:30:28.026243+00', ''),
	('00000000-0000-0000-0000-000000000000', '55715eac-c320-4233-848a-5146ea2302ca', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"8dc747c5-e198-4793-b36b-2efdad4148c5","user_phone":""}}', '2025-10-31 10:30:28.077459+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dc0cde64-078b-417d-aaaf-44486158fb88', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"69c4d212-3178-4f4b-9a03-6a1da8d6e017","user_phone":""}}', '2025-10-31 10:32:07.528494+00', ''),
	('00000000-0000-0000-0000-000000000000', '7bb010bf-8bc1-4c91-9e7e-061193417674', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"69c4d212-3178-4f4b-9a03-6a1da8d6e017","user_phone":""}}', '2025-10-31 10:32:07.580357+00', ''),
	('00000000-0000-0000-0000-000000000000', '797d152d-4a6f-4936-88ed-89426aaa8074', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"38d08bed-abff-49b0-8a94-4b823441a60f","user_phone":""}}', '2025-10-31 10:34:41.070661+00', ''),
	('00000000-0000-0000-0000-000000000000', '9925c459-0434-459c-9aa9-4629bb9d5476', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"38d08bed-abff-49b0-8a94-4b823441a60f","user_phone":""}}', '2025-10-31 10:34:41.151908+00', ''),
	('00000000-0000-0000-0000-000000000000', '3858844f-07c5-4e6f-8ea0-ddeaa539de60', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"8ef178f1-6ea3-4989-9de1-50e3e5e6970f","user_phone":""}}', '2025-10-31 10:34:42.383918+00', ''),
	('00000000-0000-0000-0000-000000000000', '5bc3100c-6b43-4223-a4af-3d4b22114390', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"8ef178f1-6ea3-4989-9de1-50e3e5e6970f","user_phone":""}}', '2025-10-31 10:34:42.429786+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a911729e-8457-4a49-8df6-2c3fa260047c', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"123456@gmail.com","user_id":"86140ff1-e962-4595-b091-8cf8c25175c5","user_phone":""}}', '2025-10-31 10:36:00.812666+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd35f088e-1245-4397-810f-2848e00e9fed', '{"action":"login","actor_id":"86140ff1-e962-4595-b091-8cf8c25175c5","actor_name":"123456","actor_username":"123456@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 10:36:35.208328+00', ''),
	('00000000-0000-0000-0000-000000000000', '54ad5bd2-c5ff-482a-9324-7b53f49efac4', '{"action":"logout","actor_id":"86140ff1-e962-4595-b091-8cf8c25175c5","actor_name":"123456","actor_username":"123456@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 10:36:35.469479+00', ''),
	('00000000-0000-0000-0000-000000000000', '19e692af-cf41-4e41-be84-5cf39bdcfb26', '{"action":"login","actor_id":"86140ff1-e962-4595-b091-8cf8c25175c5","actor_name":"123456","actor_username":"123456@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 10:36:46.790157+00', ''),
	('00000000-0000-0000-0000-000000000000', '2a799c50-c4bc-4eff-8d64-1e5c07f1d529', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 12:02:40.751736+00', ''),
	('00000000-0000-0000-0000-000000000000', '03017d8e-fdd5-49cf-b589-9f51322d03dd', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 12:02:40.754186+00', ''),
	('00000000-0000-0000-0000-000000000000', '0cc679d6-9eaa-4458-8aaa-6e52f9882e6b', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 12:02:40.856112+00', ''),
	('00000000-0000-0000-0000-000000000000', '032589fb-8492-4f9d-90f8-04ec76450881', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 12:02:40.856807+00', ''),
	('00000000-0000-0000-0000-000000000000', '93a1cf98-d621-4da3-9a51-a5147c8d8b1e', '{"action":"token_refreshed","actor_id":"86140ff1-e962-4595-b091-8cf8c25175c5","actor_name":"123456","actor_username":"123456@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 12:02:41.484566+00', ''),
	('00000000-0000-0000-0000-000000000000', '144fccdd-801d-4d76-a485-5c15e8fb4113', '{"action":"token_revoked","actor_id":"86140ff1-e962-4595-b091-8cf8c25175c5","actor_name":"123456","actor_username":"123456@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 12:02:41.485968+00', ''),
	('00000000-0000-0000-0000-000000000000', '7291728b-02d6-4e41-84c1-f20227ed67d5', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:22.488896+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fcbb363d-37e6-4ad5-ad58-9380908eea7e', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:32.279469+00', ''),
	('00000000-0000-0000-0000-000000000000', '05049fe7-d8d6-40ee-9614-3bdebc0b1142', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:32.682776+00', ''),
	('00000000-0000-0000-0000-000000000000', '2408fef2-c717-40a4-9290-6b883b6d9a2f', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:32.920571+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd8659835-a2af-4699-a9af-a5bbc5bb8c80', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:33.152587+00', ''),
	('00000000-0000-0000-0000-000000000000', '3df65ab0-ae8c-4a76-bd1d-c19cd664f83d', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:33.381914+00', ''),
	('00000000-0000-0000-0000-000000000000', 'cf1d0a4f-1983-4ad8-8303-8257dc8c77f7', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:33.66853+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e3168aba-7212-48a4-83aa-f0651584d6bf', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:33.846637+00', ''),
	('00000000-0000-0000-0000-000000000000', '1480081b-fe35-42e6-8a47-60539fec78c6', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 12:37:34.061848+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fc114816-590b-4c34-945b-c79069e18c88', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 13:01:05.885555+00', ''),
	('00000000-0000-0000-0000-000000000000', '7e6c1cdb-f7ff-494a-8e30-c85767da6cac', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 13:01:05.894897+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd9c1c528-ea8f-408a-9b5b-afa2974face4', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 13:36:04.243754+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bcea7ae4-51a5-4e3a-9d66-bec514925e97', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 13:36:04.26044+00', ''),
	('00000000-0000-0000-0000-000000000000', '86826a80-f62e-4e83-b56a-3f3a2fc04d75', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 13:59:30.29149+00', ''),
	('00000000-0000-0000-0000-000000000000', '101b3c31-d6d4-4326-a0ed-7a70789350d7', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 13:59:30.298599+00', ''),
	('00000000-0000-0000-0000-000000000000', 'cf8b9969-dfaa-4ec7-9742-a83aa463c04e', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 14:35:05.400123+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd9569e46-188e-41a5-b0af-7c0748dbd0e3', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 14:35:05.412678+00', ''),
	('00000000-0000-0000-0000-000000000000', '9f877b71-3afc-4472-ba0e-578cc1b68553', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"12345@gmail.com","user_id":"ef6a312c-a5a5-45df-ade6-e4cded39b419","user_phone":""}}', '2025-10-31 14:56:05.265293+00', ''),
	('00000000-0000-0000-0000-000000000000', '5b418dee-ed0a-4e94-83a2-65584b9976b8', '{"action":"login","actor_id":"ef6a312c-a5a5-45df-ade6-e4cded39b419","actor_name":"12345","actor_username":"12345@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-10-31 14:57:14.318985+00', ''),
	('00000000-0000-0000-0000-000000000000', '038063df-02c7-4fac-8ecc-237fd4f3387b', '{"action":"logout","actor_id":"ef6a312c-a5a5-45df-ade6-e4cded39b419","actor_name":"12345","actor_username":"12345@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-10-31 14:57:14.54697+00', ''),
	('00000000-0000-0000-0000-000000000000', '3019fcdb-cc1b-424b-9450-a94e4df2e3e3', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 14:57:32.505109+00', ''),
	('00000000-0000-0000-0000-000000000000', 'be966501-8fa5-4552-b13a-89aa5f54dd02', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 14:57:32.509939+00', ''),
	('00000000-0000-0000-0000-000000000000', '2da24203-ab03-4ee9-9ed1-18abc7e34d21', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 15:33:25.219863+00', ''),
	('00000000-0000-0000-0000-000000000000', '7df27627-600a-45e2-98f0-5f0c7e56edaf', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 15:33:25.230363+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd21058b5-1718-40c4-9618-2eea9c86ac3f', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 15:55:56.280009+00', ''),
	('00000000-0000-0000-0000-000000000000', '13a05bf5-d30a-426a-a9ca-910865a6c7db', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 15:55:56.304576+00', ''),
	('00000000-0000-0000-0000-000000000000', 'af992f39-6a14-4df9-86af-5ccb91587f74', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 16:32:05.859059+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c5bf1abb-bcdb-4fa6-92b7-25b2ae7bad94', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-10-31 16:32:05.868799+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd6350174-0993-4502-8c68-908956caa949', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-03 12:18:27.019492+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f25ea176-f3da-4ed7-a45f-5cd3395b3fc0', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-03 12:18:33.589788+00', ''),
	('00000000-0000-0000-0000-000000000000', '841ba391-60ce-42cb-b637-2b89d2676a27', '{"action":"login","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-03 12:18:40.858634+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b02c888e-5af0-478f-b073-3dbcd143b855', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-03 13:16:06.754998+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c7482a5a-e5aa-4101-b88e-f9c9dc579aab', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 13:16:52.716596+00', ''),
	('00000000-0000-0000-0000-000000000000', '7b6b46e0-1554-4802-8d4f-56a81c2c2dea', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 13:16:52.718416+00', ''),
	('00000000-0000-0000-0000-000000000000', '135593fd-a01f-453d-97c5-dbaa2786b451', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 13:16:57.763665+00', ''),
	('00000000-0000-0000-0000-000000000000', '32061a01-c7e8-4b6b-b857-f0b25e423faf', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 13:16:57.765371+00', ''),
	('00000000-0000-0000-0000-000000000000', '65261297-4d54-482d-8762-cb4dd1498343', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 14:15:30.67261+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bb036b7f-2499-48c3-bc60-eceb4ab3f63c', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 14:15:30.683505+00', ''),
	('00000000-0000-0000-0000-000000000000', '49347c26-fb23-40d8-941a-bc2cf680a319', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 14:15:40.751791+00', ''),
	('00000000-0000-0000-0000-000000000000', '7f963862-8b3d-4822-a849-aceb2330f470', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 14:15:40.752701+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ec3c7611-e163-4316-8658-18ee16d6ba7b', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 15:14:15.674768+00', ''),
	('00000000-0000-0000-0000-000000000000', '47255e48-5b0a-43ac-a145-7d77c4baf89f', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 15:14:15.683007+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b60a869f-fb14-47e6-a3d6-884482c584b0', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 15:14:25.585152+00', ''),
	('00000000-0000-0000-0000-000000000000', '000e5b1d-8b83-40a0-bf84-d07d15fae5b5', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 15:14:25.586218+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd86b90f0-e956-4012-afb2-072ac73c60b1', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 16:12:50.577106+00', ''),
	('00000000-0000-0000-0000-000000000000', '1eb9d947-a43e-4ea7-a1c9-f3aae475dff7', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 16:12:50.58315+00', ''),
	('00000000-0000-0000-0000-000000000000', '8d5a9beb-51eb-448d-85dc-4bcc2658f824', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 16:12:57.670917+00', ''),
	('00000000-0000-0000-0000-000000000000', '71900579-f1a7-470f-a53a-447b04c9af56', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 16:12:57.673561+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a9a761e5-46db-4dc0-9bb2-c022dab022a6', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 16:38:48.368612+00', ''),
	('00000000-0000-0000-0000-000000000000', '2b701e93-bb97-452f-b933-fe4499d5587e', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 16:38:48.380868+00', ''),
	('00000000-0000-0000-0000-000000000000', '34dc8aa8-17ac-425b-987f-6d317a538364', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 17:11:40.604449+00', ''),
	('00000000-0000-0000-0000-000000000000', '63e6373b-5a79-49ab-8187-b718c3f8bbba', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 17:11:40.613195+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b6562271-eb2f-4821-8fb6-7ffdc201b6c5', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 17:11:57.332419+00', ''),
	('00000000-0000-0000-0000-000000000000', '3f132ab1-8947-49f9-9264-fb4e6fedf78b', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-03 17:11:57.332902+00', ''),
	('00000000-0000-0000-0000-000000000000', '561012a8-b73e-46b2-bedc-ef951f85b990', '{"action":"token_refreshed","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-04 07:50:56.827633+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd7b698bc-7218-4779-be0d-20421d035de4', '{"action":"token_revoked","actor_id":"4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65","actor_username":"123123123@gmail.com","actor_via_sso":false,"log_type":"token"}', '2025-11-04 07:50:56.847712+00', ''),
	('00000000-0000-0000-0000-000000000000', '890fcefd-de8e-40db-85fe-8e8f92e9bb0b', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-04 13:20:11.892431+00', ''),
	('00000000-0000-0000-0000-000000000000', '809baec6-0790-4834-bb48-367aa6afa156', '{"action":"logout","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account"}', '2025-11-04 13:21:00.54342+00', ''),
	('00000000-0000-0000-0000-000000000000', 'de2bb62d-0a26-4ed6-b508-a0ae9ed6b370', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"yashbhesaniya1310@gmail.com","user_id":"47c4f83b-9769-481f-8c6b-87bc27f81ab7","user_phone":""}}', '2025-11-04 13:21:32.689273+00', ''),
	('00000000-0000-0000-0000-000000000000', '560e5e54-a777-4122-85a2-bd9e7b9d1455', '{"action":"login","actor_id":"47c4f83b-9769-481f-8c6b-87bc27f81ab7","actor_name":"Yashbhesaniya1310","actor_username":"yashbhesaniya1310@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-04 13:22:20.801117+00', ''),
	('00000000-0000-0000-0000-000000000000', '88d5943b-8707-4c45-9004-551305c4e7d9', '{"action":"logout","actor_id":"47c4f83b-9769-481f-8c6b-87bc27f81ab7","actor_name":"Yashbhesaniya1310","actor_username":"yashbhesaniya1310@gmail.com","actor_via_sso":false,"log_type":"account"}', '2025-11-04 13:22:20.878036+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a61c9b89-2b43-4595-98ed-3a51969ab5b2', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"yashbhesaniya1310@gmail.com","user_id":"47c4f83b-9769-481f-8c6b-87bc27f81ab7","user_phone":""}}', '2025-11-04 13:24:17.012251+00', ''),
	('00000000-0000-0000-0000-000000000000', '2917c7c2-2fd9-4f84-9aac-ce6cb3d9b640', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"yashbhesaniya1310@gmail.com","user_id":"270db77d-d8e5-4307-9ff9-3a94ce7a41ea","user_phone":""}}', '2025-11-04 13:25:16.741483+00', ''),
	('00000000-0000-0000-0000-000000000000', '5701513c-a204-4ea2-8fa2-dbdeb4dc1a55', '{"action":"login","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2025-11-04 13:26:36.706292+00', ''),
	('00000000-0000-0000-0000-000000000000', '0810d1ce-df78-43e9-a8a0-375bb5292cb5', '{"action":"user_repeated_signup","actor_id":"270db77d-d8e5-4307-9ff9-3a94ce7a41ea","actor_name":"Yashbhesaniya1310","actor_username":"yashbhesaniya1310@gmail.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-11-04 13:38:01.649378+00', ''),
	('00000000-0000-0000-0000-000000000000', '5086db06-cb8e-47a0-85dc-9ee1a261eaf3', '{"action":"user_confirmation_requested","actor_id":"ae51bd7f-edd1-4b53-a75f-ca193ac7b3aa","actor_name":"U5858100143","actor_username":"u5858100143@gmail.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-11-04 13:38:42.940402+00', ''),
	('00000000-0000-0000-0000-000000000000', '416bb473-dccf-430e-b484-f91f654834a3', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"u5858100143@gmail.com","user_id":"ae51bd7f-edd1-4b53-a75f-ca193ac7b3aa","user_phone":""}}', '2025-11-04 13:40:23.940162+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e9921c3b-774b-4e79-ad05-c23a486b0fa4', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"123456@gmail.com","user_id":"86140ff1-e962-4595-b091-8cf8c25175c5","user_phone":""}}', '2025-11-04 13:41:03.172148+00', ''),
	('00000000-0000-0000-0000-000000000000', '1c9ff2a8-e8e9-466d-b1c2-31a0ecd51e5e', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"yashbhesaniya1310@gmail.com","user_id":"270db77d-d8e5-4307-9ff9-3a94ce7a41ea","user_phone":""}}', '2025-11-04 13:44:14.572328+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b7ed6daf-83bb-4210-90f1-d780c0aa3299', '{"action":"user_confirmation_requested","actor_id":"a3945f4c-64d5-4e28-adc5-76727e7398b7","actor_name":"Yashbhesaniya1310","actor_username":"yashbhesaniya1310@gmail.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-11-04 13:44:38.120427+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e630d381-0d19-46a6-857c-258b96beb26c', '{"action":"user_deleted","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"user_email":"yashbhesaniya1310@gmail.com","user_id":"a3945f4c-64d5-4e28-adc5-76727e7398b7","user_phone":""}}', '2025-11-04 13:46:46.798359+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ab901b68-85ce-47d4-ae90-2c7d9689a872', '{"action":"user_confirmation_requested","actor_id":"8411a391-bc03-49d1-9627-fd975d98a6d4","actor_name":"Yashbhesniya1310","actor_username":"yashbhesniya1310@gmail.com","actor_via_sso":false,"log_type":"user","traits":{"provider":"email"}}', '2025-11-04 13:47:44.930053+00', ''),
	('00000000-0000-0000-0000-000000000000', '98b8f37f-5082-4ee2-9824-59cd79631713', '{"action":"token_refreshed","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-04 14:24:44.519347+00', ''),
	('00000000-0000-0000-0000-000000000000', '9aa47203-377c-4a21-be72-47264085b3ab', '{"action":"token_revoked","actor_id":"4bdfa8e5-91d5-4cbe-9e1c-882a93190292","actor_username":"yash.bhesaniya@wamocon.com","actor_via_sso":false,"log_type":"token"}', '2025-11-04 14:24:44.525169+00', '');


--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'authenticated', 'authenticated', '123123@gmail.com', '$2a$10$MSX1c/2qXWrROgJ6A5nxzenY6PyOvaViLcN6JnWSeZcuCY8AuAD0G', '2025-10-24 13:33:03.021884+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-10-31 08:26:24.143911+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "c4fd8987-87ee-443a-aac7-6e7c0808c26d", "email": "123123@gmail.com", "email_verified": true, "phone_verified": false}', NULL, '2025-10-24 13:33:02.974701+00', '2025-10-31 08:26:24.14599+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'authenticated', 'authenticated', '123123123@gmail.com', '$2a$10$8iKNofKt2UMtOKSFuviQyeEfVjNjsCU7bgDxwfqCn1xeLMD/QsQpa', '2025-10-21 08:43:13.541847+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-11-03 12:18:40.861059+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65", "email": "123123123@gmail.com", "email_verified": true, "phone_verified": false}', NULL, '2025-10-21 08:43:13.534727+00', '2025-11-04 07:50:56.924519+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '8411a391-bc03-49d1-9627-fd975d98a6d4', 'authenticated', 'authenticated', 'yashbhesniya1310@gmail.com', '$2a$10$5FrV80i2DLa9t1zxXhwG9OpfcMbm5aY6iwAq6OGD0R2RVvBDkFg.K', NULL, NULL, 'a29e178c70635373e5e87eb96c3199464d8b079ac251c2c7f932a259', '2025-11-04 13:47:44.930616+00', '', NULL, '', '', NULL, NULL, '{"provider": "email", "providers": ["email"]}', '{"sub": "8411a391-bc03-49d1-9627-fd975d98a6d4", "role": "TRAINEE", "email": "yashbhesniya1310@gmail.com", "full_name": "Yashbhesniya1310", "email_verified": false, "phone_verified": false}', NULL, '2025-11-04 13:47:44.92386+00', '2025-11-04 13:47:44.941203+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', 'authenticated', 'authenticated', 'yash.bhesaniya@wamocon.com', '$2a$10$xetcti.ys4uEkPFA7Dyqhu.IwU.vAlI.S6qvAiE1yW2PkWVA5NM62', '2025-10-21 08:31:50.794027+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-11-04 13:26:36.707046+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "4bdfa8e5-91d5-4cbe-9e1c-882a93190292", "email": "yash.bhesaniya@wamocon.com", "email_verified": true, "phone_verified": false}', NULL, '2025-10-21 08:31:50.782149+00', '2025-11-04 14:24:44.545155+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'ef6a312c-a5a5-45df-ade6-e4cded39b419', 'authenticated', 'authenticated', '12345@gmail.com', '$2a$10$eO.QbBhh.2Qq2tocgsKOkuepwkN2VVBcrfuBktL3SbzQDzFzMbQMu', '2025-10-31 14:56:05.277043+00', NULL, '', NULL, '', NULL, '', '', NULL, '2025-10-31 14:57:14.325812+00', '{"provider": "email", "providers": ["email"]}', '{"role": "TRAINEE", "full_name": "12345", "email_verified": true}', NULL, '2025-10-31 14:56:05.111045+00', '2025-10-31 14:57:14.352379+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '{"sub": "4bdfa8e5-91d5-4cbe-9e1c-882a93190292", "email": "yash.bhesaniya@wamocon.com", "email_verified": false, "phone_verified": false}', 'email', '2025-10-21 08:31:50.790346+00', '2025-10-21 08:31:50.790382+00', '2025-10-21 08:31:50.790382+00', 'fc43cc51-e7f4-49e7-923c-40585baf8e45'),
	('4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '{"sub": "4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65", "email": "123123123@gmail.com", "email_verified": false, "phone_verified": false}', 'email', '2025-10-21 08:43:13.539403+00', '2025-10-21 08:43:13.539428+00', '2025-10-21 08:43:13.539428+00', '358404ba-754e-4829-af4d-3cc1c981f244'),
	('c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '{"sub": "c4fd8987-87ee-443a-aac7-6e7c0808c26d", "email": "123123@gmail.com", "email_verified": false, "phone_verified": false}', 'email', '2025-10-24 13:33:03.015173+00', '2025-10-24 13:33:03.015411+00', '2025-10-24 13:33:03.015411+00', '25bd38ec-fd55-419b-934e-4afbd4bdb56c'),
	('ef6a312c-a5a5-45df-ade6-e4cded39b419', 'ef6a312c-a5a5-45df-ade6-e4cded39b419', '{"sub": "ef6a312c-a5a5-45df-ade6-e4cded39b419", "email": "12345@gmail.com", "email_verified": false, "phone_verified": false}', 'email', '2025-10-31 14:56:05.258422+00', '2025-10-31 14:56:05.258584+00', '2025-10-31 14:56:05.258584+00', '504fc329-0a87-4e24-9ba4-301b7a4b7b48'),
	('8411a391-bc03-49d1-9627-fd975d98a6d4', '8411a391-bc03-49d1-9627-fd975d98a6d4', '{"sub": "8411a391-bc03-49d1-9627-fd975d98a6d4", "role": "TRAINEE", "email": "yashbhesniya1310@gmail.com", "full_name": "Yashbhesniya1310", "email_verified": false, "phone_verified": false}', 'email', '2025-11-04 13:47:44.92804+00', '2025-11-04 13:47:44.928071+00', '2025-11-04 13:47:44.928071+00', '2a69b089-3fbb-4010-aaff-db86c599dce8');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id") VALUES
	('44f8d0ff-1067-494c-bd47-4d83cdc3a2b2', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 09:45:39.734013+00', '2025-10-31 12:02:40.859469+00', NULL, 'aal1', NULL, '2025-10-31 12:02:40.859431', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('30bd9584-578d-4d50-a883-82bf2c07870e', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:22.499561+00', '2025-10-31 12:37:22.499561+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('63b4d890-05bf-4c9c-ba34-79173bbe4ba5', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:32.280634+00', '2025-10-31 12:37:32.280634+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('26d91b6e-7968-4ae8-b009-f8936a77df8f', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:32.68465+00', '2025-10-31 12:37:32.68465+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('6413c987-a5e8-4ff3-8f02-244cc81b7490', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:32.92165+00', '2025-10-31 12:37:32.92165+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('fc668e86-fdc7-4069-b607-fc28f1a365b4', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:33.15389+00', '2025-10-31 12:37:33.15389+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('634f5e37-6130-4004-9830-60e4d3499749', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:33.385147+00', '2025-10-31 12:37:33.385147+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('f8e17f56-0ed8-4374-a6ed-ec97281a01f7', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:33.66927+00', '2025-10-31 12:37:33.66927+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('e177d9ac-4d57-40b5-a69f-700214354901', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:33.847657+00', '2025-10-31 12:37:33.847657+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('a61be7d9-06a6-47a9-afcb-b0d8826599f3', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-31 12:37:34.062998+00', '2025-10-31 16:32:05.890744+00', NULL, 'aal1', NULL, '2025-10-31 16:32:05.890692', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('a327af8c-5b0c-4d79-9837-0deb08d6a439', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-11-03 12:18:33.591257+00', '2025-11-03 12:18:33.591257+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('2a45ef40-f98d-4010-9e01-170c9a71bd38', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-11-03 12:18:40.861147+00', '2025-11-04 07:50:56.938157+00', NULL, 'aal1', NULL, '2025-11-04 07:50:56.937986', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.18.0.1', NULL, NULL),
	('a88f919b-ef8d-461d-8870-88968eeca4d3', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-11-04 13:26:36.707137+00', '2025-11-04 14:24:44.55032+00', NULL, 'aal1', NULL, '2025-11-04 14:24:44.550271', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', '172.19.0.1', NULL, NULL);


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") VALUES
	('44f8d0ff-1067-494c-bd47-4d83cdc3a2b2', '2025-10-31 09:45:39.743937+00', '2025-10-31 09:45:39.743937+00', 'password', '1186359a-b059-4524-81aa-cced4d0b2848'),
	('30bd9584-578d-4d50-a883-82bf2c07870e', '2025-10-31 12:37:22.515448+00', '2025-10-31 12:37:22.515448+00', 'password', 'a467b4c1-4edd-4bee-846d-e0320b873da3'),
	('63b4d890-05bf-4c9c-ba34-79173bbe4ba5', '2025-10-31 12:37:32.286111+00', '2025-10-31 12:37:32.286111+00', 'password', 'b1ed674d-e270-4627-bef1-025a31226b73'),
	('26d91b6e-7968-4ae8-b009-f8936a77df8f', '2025-10-31 12:37:32.690184+00', '2025-10-31 12:37:32.690184+00', 'password', '9e9775f0-7a16-4f12-a5a8-b5689b643ed0'),
	('6413c987-a5e8-4ff3-8f02-244cc81b7490', '2025-10-31 12:37:32.924844+00', '2025-10-31 12:37:32.924844+00', 'password', '95a5cdf5-b40d-4965-8f68-3d85570991c6'),
	('fc668e86-fdc7-4069-b607-fc28f1a365b4', '2025-10-31 12:37:33.165356+00', '2025-10-31 12:37:33.165356+00', 'password', '31bd0947-6162-4483-8cdf-eebf05037e7b'),
	('634f5e37-6130-4004-9830-60e4d3499749', '2025-10-31 12:37:33.388981+00', '2025-10-31 12:37:33.388981+00', 'password', '51ef03c4-fe8f-4982-8610-86fdd162efc3'),
	('f8e17f56-0ed8-4374-a6ed-ec97281a01f7', '2025-10-31 12:37:33.671433+00', '2025-10-31 12:37:33.671433+00', 'password', '71a49b49-6e3d-4cde-9275-20c9d889acc4'),
	('e177d9ac-4d57-40b5-a69f-700214354901', '2025-10-31 12:37:33.851824+00', '2025-10-31 12:37:33.851824+00', 'password', 'ea96353b-5985-4d4b-be1e-19d1448f906a'),
	('a61be7d9-06a6-47a9-afcb-b0d8826599f3', '2025-10-31 12:37:34.064581+00', '2025-10-31 12:37:34.064581+00', 'password', 'ceda1123-0924-4962-a416-6ff92870c197'),
	('a327af8c-5b0c-4d79-9837-0deb08d6a439', '2025-11-03 12:18:33.596995+00', '2025-11-03 12:18:33.596995+00', 'password', 'c6808c72-da5f-4d0e-a76b-b55f69ea9007'),
	('2a45ef40-f98d-4010-9e01-170c9a71bd38', '2025-11-03 12:18:40.871617+00', '2025-11-03 12:18:40.871617+00', 'password', 'f01f5106-8bb9-4ac0-9d71-67fbfd9da678'),
	('a88f919b-ef8d-461d-8870-88968eeca4d3', '2025-11-04 13:26:36.71018+00', '2025-11-04 13:26:36.71018+00', 'password', 'f7e0ae17-202c-49cd-a0a7-c044de18d0ac');


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."one_time_tokens" ("id", "user_id", "token_type", "token_hash", "relates_to", "created_at", "updated_at") VALUES
	('fc672573-4133-4321-a0a0-cd13f04e2ab6', '8411a391-bc03-49d1-9627-fd975d98a6d4', 'confirmation_token', 'a29e178c70635373e5e87eb96c3199464d8b079ac251c2c7f932a259', 'yashbhesniya1310@gmail.com', '2025-11-04 13:47:44.942214', '2025-11-04 13:47:44.942214');


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") VALUES
	('00000000-0000-0000-0000-000000000000', 127, 'eqimvyzeou73', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-10-31 09:45:39.739877+00', '2025-10-31 12:02:40.857521+00', NULL, '44f8d0ff-1067-494c-bd47-4d83cdc3a2b2'),
	('00000000-0000-0000-0000-000000000000', 195, 'enu6376rxhqe', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:02:40.857873+00', '2025-10-31 12:02:40.857873+00', 'eqimvyzeou73', '44f8d0ff-1067-494c-bd47-4d83cdc3a2b2'),
	('00000000-0000-0000-0000-000000000000', 197, 'jdgerdyrua2o', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:22.508228+00', '2025-10-31 12:37:22.508228+00', NULL, '30bd9584-578d-4d50-a883-82bf2c07870e'),
	('00000000-0000-0000-0000-000000000000', 198, 'qle6htz4wytt', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:32.28231+00', '2025-10-31 12:37:32.28231+00', NULL, '63b4d890-05bf-4c9c-ba34-79173bbe4ba5'),
	('00000000-0000-0000-0000-000000000000', 199, 'npekvy3eypj6', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:32.686375+00', '2025-10-31 12:37:32.686375+00', NULL, '26d91b6e-7968-4ae8-b009-f8936a77df8f'),
	('00000000-0000-0000-0000-000000000000', 200, 'drjpynt4aev3', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:32.922648+00', '2025-10-31 12:37:32.922648+00', NULL, '6413c987-a5e8-4ff3-8f02-244cc81b7490'),
	('00000000-0000-0000-0000-000000000000', 201, 'cgh3jjbe5xnq', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:33.155973+00', '2025-10-31 12:37:33.155973+00', NULL, 'fc668e86-fdc7-4069-b607-fc28f1a365b4'),
	('00000000-0000-0000-0000-000000000000', 202, '2fvimpmgkvjp', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:33.38718+00', '2025-10-31 12:37:33.38718+00', NULL, '634f5e37-6130-4004-9830-60e4d3499749'),
	('00000000-0000-0000-0000-000000000000', 203, 'n3ptpwjzpu73', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:33.669926+00', '2025-10-31 12:37:33.669926+00', NULL, 'f8e17f56-0ed8-4374-a6ed-ec97281a01f7'),
	('00000000-0000-0000-0000-000000000000', 204, 'wwz3m36ch7c7', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 12:37:33.849015+00', '2025-10-31 12:37:33.849015+00', NULL, 'e177d9ac-4d57-40b5-a69f-700214354901'),
	('00000000-0000-0000-0000-000000000000', 205, '6ilahcgz7j3n', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-10-31 12:37:34.063832+00', '2025-10-31 13:36:04.262443+00', NULL, 'a61be7d9-06a6-47a9-afcb-b0d8826599f3'),
	('00000000-0000-0000-0000-000000000000', 207, 'o2cyg76zbazw', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-10-31 13:36:04.273114+00', '2025-10-31 14:35:05.413995+00', '6ilahcgz7j3n', 'a61be7d9-06a6-47a9-afcb-b0d8826599f3'),
	('00000000-0000-0000-0000-000000000000', 209, 'fk5vgiklyggp', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-10-31 14:35:05.423271+00', '2025-10-31 15:33:25.232398+00', 'o2cyg76zbazw', 'a61be7d9-06a6-47a9-afcb-b0d8826599f3'),
	('00000000-0000-0000-0000-000000000000', 212, 'shcddbkjocka', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-10-31 15:33:25.241499+00', '2025-10-31 16:32:05.872795+00', 'fk5vgiklyggp', 'a61be7d9-06a6-47a9-afcb-b0d8826599f3'),
	('00000000-0000-0000-0000-000000000000', 214, 'rj3vwkidujfu', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-10-31 16:32:05.878297+00', '2025-10-31 16:32:05.878297+00', 'shcddbkjocka', 'a61be7d9-06a6-47a9-afcb-b0d8826599f3'),
	('00000000-0000-0000-0000-000000000000', 216, 'h2mmq34xozfk', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-11-03 12:18:33.595366+00', '2025-11-03 12:18:33.595366+00', NULL, 'a327af8c-5b0c-4d79-9837-0deb08d6a439'),
	('00000000-0000-0000-0000-000000000000', 217, '6aisduae3fud', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-11-03 12:18:40.863242+00', '2025-11-03 13:16:52.719078+00', NULL, '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 219, 'r4vi5zbmpfss', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-11-03 13:16:52.725502+00', '2025-11-03 14:15:40.753075+00', '6aisduae3fud', '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 222, '3f3rhwke2tqj', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-11-03 14:15:40.753399+00', '2025-11-03 15:14:25.586678+00', 'r4vi5zbmpfss', '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 224, '4f6u3433oqla', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-11-03 15:14:25.587062+00', '2025-11-03 16:12:57.674052+00', '3f3rhwke2tqj', '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 226, 'spcnbpkr42sx', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-11-03 16:12:57.678114+00', '2025-11-03 17:11:57.333392+00', '4f6u3433oqla', '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 229, 'ifuzlrwo4vy4', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', true, '2025-11-03 17:11:57.333783+00', '2025-11-04 07:50:56.854338+00', 'spcnbpkr42sx', '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 230, '3mhnxeaqxzgr', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', false, '2025-11-04 07:50:56.869578+00', '2025-11-04 07:50:56.869578+00', 'ifuzlrwo4vy4', '2a45ef40-f98d-4010-9e01-170c9a71bd38'),
	('00000000-0000-0000-0000-000000000000', 233, 'maa4gvnkk5y2', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, '2025-11-04 13:26:36.708326+00', '2025-11-04 14:24:44.526408+00', NULL, 'a88f919b-ef8d-461d-8870-88968eeca4d3'),
	('00000000-0000-0000-0000-000000000000', 234, 'inrfzf7nbbk7', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', false, '2025-11-04 14:24:44.538755+00', '2025-11-04 14:24:44.538755+00', 'maa4gvnkk5y2', 'a88f919b-ef8d-461d-8870-88968eeca4d3');


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."profiles" ("id", "full_name", "email", "avatar_url", "role", "start_of_training_date", "assigned_trainer_id", "created_at", "updated_at", "is_active") VALUES
	('4bdfa8e5-91d5-4cbe-9e1c-882a93190292', 'Trainer One', 'trainer.one@example.com', 'http://127.0.0.1:54321/storage/v1/object/public/avatars/4bdfa8e5-91d5-4cbe-9e1c-882a93190292/1761742217328_profile.jpg', 'TRAINER', NULL, NULL, '2025-10-28 09:27:25.524494', '2025-10-29 14:02:34.297', true),
	('ef6a312c-a5a5-45df-ade6-e4cded39b419', '12345', '12345@gmail.com', NULL, 'TRAINEE', NULL, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-31 14:56:05.105115', '2025-11-04 13:28:09.087', true),
	('4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Trainee Beta', 'trainee.beta@example.com', 'http://127.0.0.1:54321/storage/v1/object/public/avatars/4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65/1761742652728_profile_1.jpg', 'TRAINEE', '2025-10-28 09:27:25.599', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.524494', '2025-10-31 08:25:38.608', true),
	('c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'Trainee Alpha', 'trainee.alpha@example.com', '', 'TRAINEE', '2025-11-30 00:00:00', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.524494', '2025-10-31 08:26:28.412', false),
	('8411a391-bc03-49d1-9627-fd975d98a6d4', 'Yashbhesniya1310', 'yashbhesniya1310@gmail.com', NULL, 'TRAINEE', NULL, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-11-04 13:47:44.923488', '2025-11-04 13:47:45.588', false);


--
-- Data for Name: acceptance_protocols; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."acceptance_protocols" ("id", "trainee_id", "trainer_id", "acceptance_date", "milestone", "comments", "important_instructions", "generated_at", "pdf_url") VALUES
	('0f798166-46e4-433d-8916-906a490939e8', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.694', 'Module 1 Complete', 'Well done', 'Proceed to next module', '2025-10-28 09:27:25.524494', 'https://files.example.com/protocol1.pdf'),
	('1a9f810d-50a5-4217-b30e-8411068acd24', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.694', 'Onboarding', 'Welcome aboard', 'Start Web Essentials', '2025-10-28 09:27:25.524494', 'https://files.example.com/protocol2.pdf'),
	('40754c85-4234-4067-9437-7c7444402347', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-30 00:00:00', 'test', 'Test', NULL, '2025-10-30 15:14:35.535702', NULL),
	('9e49c73e-942e-4d31-8142-96d4de097dbf', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-30 00:00:00', 'test', 'test', NULL, '2025-10-30 15:22:41.059005', NULL),
	('84d03527-bf18-494f-9399-002dc27970cc', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-30 00:00:00', 'test', 'test', NULL, '2025-10-30 15:23:51.281717', NULL),
	('76d0a09e-2824-4610-86f2-9564329a0f2d', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-30 00:00:00', 'tes', 'tes', NULL, '2025-10-30 15:45:02.153306', NULL),
	('cf39814d-f750-4c35-b9c7-897344b1c661', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-30 00:00:00', 'dfvd', 'dfvdf', NULL, '2025-10-30 15:45:19.43898', NULL),
	('b781ac44-ca4e-41e0-9f14-e7f085b6e9dd', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-31 00:00:00', 'sds', 'gsdf', NULL, '2025-10-31 12:05:58.347568', NULL);


--
-- Data for Name: activity_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."activity_log" ("id", "user_id", "activity_type", "related_item_id", "related_item_table", "context", "created_at") VALUES
	('65b93334-ec38-4b7f-8160-985a4de7f551', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'QUIZ_SUBMITTED', '6c1375d4-ade2-411e-9991-1468b36d40d7', 'quiz_submissions', '{"score": 100}', '2025-10-28 09:27:25.524494'),
	('1ffeb1dd-1fd9-46ac-a781-1f9018a551d3', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'COURSE_ASSIGNED', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'courses', '{"title": "Web Essentials"}', '2025-10-28 09:27:25.524494');


--
-- Data for Name: courses; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."courses" ("id", "title", "description", "year", "chapter", "created_by_id", "is_active", "is_published", "created_at", "updated_at") VALUES
	('573810ec-cce8-44d1-a373-48ca11ed0b89', 'test', NULL, 2, 2, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', false, false, '2025-10-28 12:14:15.18048', '2025-10-28 15:22:07.819'),
	('3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'Web Essentials', 'Foundations of web development with hands-on practice.', 1, 1, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, true, '2025-10-28 09:27:25.524494', '2025-10-29 15:34:56.202');


--
-- Data for Name: course_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."course_members" ("id", "course_id", "user_id", "role") VALUES
	('f077191e-fbea-4a67-8ede-539f397cc19c', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'TRAINEE'),
	('ae69c6d6-4b5b-4d29-9b53-ede8a77bfecd', '573810ec-cce8-44d1-a373-48ca11ed0b89', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'TRAINEE'),
	('7a75d8fd-729a-4c54-96f1-90f8269f5b48', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'TRAINEE');


--
-- Data for Name: skills; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."skills" ("id", "name") VALUES
	('18e4fbda-5f89-4ffd-a895-43531365c4b3', 'HTML/CSS'),
	('ce39324f-80bb-4d47-94ca-42f946d8e88e', 'JavaScript'),
	('d582e2ca-1e09-4122-a37e-13bd1a5d59ab', 'Git'),
	('0e602d55-305f-45e6-b20b-3b016a426a97', 'testing');


--
-- Data for Name: course_skills; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."course_skills" ("course_id", "skill_id") VALUES
	('573810ec-cce8-44d1-a373-48ca11ed0b89', '0e602d55-305f-45e6-b20b-3b016a426a97'),
	('3ae90667-1a9d-42ac-98f4-2d760f9192bd', '18e4fbda-5f89-4ffd-a895-43531365c4b3'),
	('3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'ce39324f-80bb-4d47-94ca-42f946d8e88e'),
	('3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'd582e2ca-1e09-4122-a37e-13bd1a5d59ab');


--
-- Data for Name: enablers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."enablers" ("id", "course_id", "title", "order_index", "ppt_url", "video_url", "scenario_text", "scenario_image_url", "duration_value", "duration_unit", "is_active", "created_at", "updated_at", "description_text", "activated_at", "hint_text") VALUES
	('42aa9627-21fd-44dd-ab4b-3d1503c4951c', '573810ec-cce8-44d1-a373-48ca11ed0b89', 'Test', 1, 'abc', 'anc', 'Test Description', NULL, NULL, NULL, false, '2025-10-28 13:01:08.740589', '2025-10-28 13:01:18.472', NULL, NULL, NULL),
	('cd080ee9-f563-4b6f-89a1-7113baa00366', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'HTML & CSS Enabler', 1, NULL, NULL, 'Build a responsive landing page from a brief.', NULL, 2, 'WEEKS', true, '2025-10-28 09:27:25.524494', '2025-10-28 16:00:01.893', NULL, NULL, NULL),
	('0d651497-3fb2-4834-92b7-b0165bd12fec', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'Test 1', 2, 'link', 'link', 'Test Szenario', NULL, 9, 'DAYS', true, '2025-10-28 15:31:10.724654', '2025-10-29 15:47:47.55', 'test Beschreibung', '2025-10-29 08:49:38.272', 'Test_Tip');


--
-- Data for Name: enabler_completions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."enabler_completions" ("trainee_id", "enabler_id", "completed_at") VALUES
	('c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'cd080ee9-f563-4b6f-89a1-7113baa00366', '2025-10-28 09:27:25.524494');


--
-- Data for Name: quizzes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."quizzes" ("id", "title", "quiz_type", "created_by_id", "is_active", "created_at", "updated_at") VALUES
	('3bd11d4b-d48c-43ba-8e8d-c7f91811135b', 'Enabler Quiz: HTML & CSS', 'LESSON', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, '2025-10-28 09:27:25.524494', '2025-10-28 09:27:25.524494'),
	('03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', 'Global Quiz: Web Basics', 'GLOBAL', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, '2025-10-28 09:27:25.524494', '2025-10-28 09:27:25.524494'),
	('6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', 'Testing', 'GLOBAL', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, '2025-10-28 09:45:47.544355', '2025-10-28 09:45:47.544355'),
	('4fc5f178-289d-4c16-951a-28be36374d07', 'Quiz: Test', 'LESSON', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, '2025-10-28 13:01:09.461071', '2025-10-28 13:01:09.461071'),
	('09df3b88-8650-4ec5-8101-3e6ed70f53e6', 'Quiz: Test 1', 'LESSON', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', true, '2025-10-29 09:01:09.117351', '2025-10-29 09:01:09.117351');


--
-- Data for Name: enabler_quizzes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."enabler_quizzes" ("enabler_id", "quiz_id") VALUES
	('cd080ee9-f563-4b6f-89a1-7113baa00366', '3bd11d4b-d48c-43ba-8e8d-c7f91811135b'),
	('42aa9627-21fd-44dd-ab4b-3d1503c4951c', '4fc5f178-289d-4c16-951a-28be36374d07'),
	('0d651497-3fb2-4834-92b7-b0165bd12fec', '09df3b88-8650-4ec5-8101-3e6ed70f53e6');


--
-- Data for Name: enabler_submissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."enabler_submissions" ("id", "trainee_id", "enabler_id", "solution_text", "status", "trainer_feedback", "reviewed_by_id", "reviewed_at", "submitted_at") VALUES
	('c851badf-3cc4-4693-a963-dafe4e7edb89', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '0d651497-3fb2-4834-92b7-b0165bd12fec', 'hello', 'APPROVED', 'Good', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-30 16:26:13.253', '2025-10-29 09:01:35.682966');


--
-- Data for Name: knowledge_notes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."knowledge_notes" ("id", "trainee_id", "title", "content", "onedrive_link", "created_at", "updated_at") VALUES
	('927250ed-c8a0-48e6-b3fc-279075d3a19b', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'Flexbox Cheatsheet', 'Notes on flex properties.', NULL, '2025-10-28 09:27:25.524494', '2025-10-28 09:27:25.524494'),
	('1b68d2be-0ee6-49d9-b235-48f4dd5a4328', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'CSS Grid Areas', 'Grid templates and areas.', 'https://1drv.ms/mock', '2025-10-28 09:27:25.524494', '2025-10-28 09:27:25.524494'),
	('49fb8ccc-ec30-4dd5-a633-fce77c067197', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Test', 'Test description', NULL, '2025-10-28 10:17:51.401693', '2025-10-28 10:17:51.401693'),
	('928d8002-192e-444e-a1a1-b892669c9a93', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Test 2_', 'test 2 description', NULL, '2025-10-28 10:18:58.1736', '2025-10-28 10:25:25.658');


--
-- Data for Name: modules; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: lessons; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."notifications" ("id", "user_id", "actor_id", "type", "title", "message", "link_url", "context", "is_read", "read_at", "created_at") VALUES
	('0fd6c5eb-aada-4108-8e22-efa173901966', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'REFLECTION_SUBMITTED', 'Reflexion eingereicht', 'Trainee Beta hat eine Reflexion eingereicht', '/trainer/reflections', '{"traineeId": "4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65", "reflectionId": "cd8d4a56-8ed6-44eb-8486-119fb6dc46e4"}', true, '2025-11-03 12:48:45.796', '2025-11-03 12:47:51.928878'),
	('2ce871b9-c23d-4634-a56a-6adf75ca49cc', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', 'REFLECTION_REVIEWED', 'Reflexion bewertet', 'Deine Reflexion wurde bewertet', '/trainee/reflection', '{"reflectionId": "cd8d4a56-8ed6-44eb-8486-119fb6dc46e4"}', true, '2025-11-03 12:49:19.879', '2025-11-03 12:48:55.894387');


--
-- Data for Name: questions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."questions" ("id", "quiz_id", "question_text", "order_index") VALUES
	('5073c818-34b0-4c78-9751-734b3e614196', '3bd11d4b-d48c-43ba-8e8d-c7f91811135b', 'Which tag creates a hyperlink?', 1),
	('4770a8b9-50aa-44f0-b552-326fb29edf83', '3bd11d4b-d48c-43ba-8e8d-c7f91811135b', 'Which CSS property sets text color?', 2),
	('151c637f-fe61-4ac8-abbe-fd5eef9536f7', '03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', 'CSS stands for?', 1),
	('21375af6-d96d-4d40-94c3-0d194aad8f1c', '03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', 'JS is primarily executed in the ___?', 2),
	('ed5257ea-1d5f-4992-a512-55c903242ac1', '6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', 'Test 1', 1),
	('5ab7feac-665a-4941-80e8-6982fab5bb1f', '6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', 'Test 2', 2),
	('692fc0c5-e4a6-49b9-9611-120e94202ff9', '6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', 'Test 3', 3),
	('d5a22218-aa5f-493f-afac-a715c000cd1b', '6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', 'Test 4', 4),
	('5e5e6bcb-4689-4c4d-a9b2-2ff65fa1796f', '4fc5f178-289d-4c16-951a-28be36374d07', 'Test_q', 1),
	('a40d8bef-f808-4eb1-bb31-65b1cd36a86f', '09df3b88-8650-4ec5-8101-3e6ed70f53e6', 'Test_q', 1),
	('4b7da523-548a-43fd-965c-9721331582db', '09df3b88-8650-4ec5-8101-3e6ed70f53e6', 'Test_q2', 2);


--
-- Data for Name: options; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."options" ("id", "question_id", "option_text", "is_correct") VALUES
	('82253916-71aa-4ce5-9fa2-1f268a71dd11', '5073c818-34b0-4c78-9751-734b3e614196', '<a>', true),
	('49b356c2-c90f-4585-9dd6-aba623befa13', '5073c818-34b0-4c78-9751-734b3e614196', '<link>', false),
	('e75dedc2-5ae9-41de-b76d-7b385a59635c', '5073c818-34b0-4c78-9751-734b3e614196', '<href>', false),
	('af783769-6709-4d33-9324-beb271313726', '4770a8b9-50aa-44f0-b552-326fb29edf83', 'font-color', false),
	('50142959-f55d-4bfb-816a-0de2ecd8cebb', '4770a8b9-50aa-44f0-b552-326fb29edf83', 'color', true),
	('54f7ae88-e04f-411f-8936-0f8c0e5e2e41', '4770a8b9-50aa-44f0-b552-326fb29edf83', 'text-style', false),
	('4e00a2d1-21f2-47b6-b3c3-bc62f940fedd', '151c637f-fe61-4ac8-abbe-fd5eef9536f7', 'Cascading Style Sheets', true),
	('24627f6f-6ec6-4225-b304-73adf65c6ad2', '151c637f-fe61-4ac8-abbe-fd5eef9536f7', 'Creative Styling Syntax', false),
	('08d63554-30ab-49d1-acb8-3ca5102dbae2', '151c637f-fe61-4ac8-abbe-fd5eef9536f7', 'Computer Styled System', false),
	('ec010d15-84b4-4b7d-9b56-ec06640d4966', '21375af6-d96d-4d40-94c3-0d194aad8f1c', 'Database', false),
	('b68de67f-9276-4e87-8c23-bb11443749c9', '21375af6-d96d-4d40-94c3-0d194aad8f1c', 'Browser', true),
	('4ad24019-f82b-4917-b7bb-8495e782ac6d', '21375af6-d96d-4d40-94c3-0d194aad8f1c', 'Server only', false),
	('b7ecfb6c-6960-4d1a-afac-e3a51db32bc9', 'ed5257ea-1d5f-4992-a512-55c903242ac1', 'Test_option_1', false),
	('5a0d6cc0-0e87-4546-8a5d-3cd3bf5c8adc', 'ed5257ea-1d5f-4992-a512-55c903242ac1', 'Test_option_2', true),
	('b5d58614-377d-420e-b206-2ee23e53620a', 'ed5257ea-1d5f-4992-a512-55c903242ac1', 'Test_option_3', false),
	('87aa2f22-cce7-45e0-a675-d371d254522d', 'ed5257ea-1d5f-4992-a512-55c903242ac1', 'Test_option_4', false),
	('50c4d10f-aa94-4f7b-b8a0-6f21e5492fad', '5ab7feac-665a-4941-80e8-6982fab5bb1f', 'Test_option_1', false),
	('3b17433a-5b9d-448c-84dc-b92cc135b2f7', '5ab7feac-665a-4941-80e8-6982fab5bb1f', 'Test_option_2', true),
	('29bd540b-ed33-4441-9632-71f9d1ee98b8', '5ab7feac-665a-4941-80e8-6982fab5bb1f', 'Test_option_3', false),
	('7596ee1b-d580-407c-afc8-57da4cc8ce93', '5ab7feac-665a-4941-80e8-6982fab5bb1f', 'Test_option_4', false),
	('29c38e52-b47b-4cbe-baef-9af995840249', '692fc0c5-e4a6-49b9-9611-120e94202ff9', 'Test_option_1', false),
	('e64b1fe5-e8e2-415d-99b2-2aae3c952adb', '692fc0c5-e4a6-49b9-9611-120e94202ff9', 'Test_option_2', false),
	('ebd5387e-64d0-42cd-8849-936faf4a7187', '692fc0c5-e4a6-49b9-9611-120e94202ff9', 'Test_option_3', true),
	('036611b6-19e7-4ca0-a595-23bcac9917ab', '692fc0c5-e4a6-49b9-9611-120e94202ff9', 'Test_option_4', false),
	('07e02211-3541-48b6-bd0d-daa97e6f5c22', 'd5a22218-aa5f-493f-afac-a715c000cd1b', 'Test_option_1', false),
	('0bd1c1ac-397b-437a-9bab-fef99709d34e', 'd5a22218-aa5f-493f-afac-a715c000cd1b', 'Test_option_2', false),
	('ccec5de3-4724-4fe8-a878-e9991c978f9a', 'd5a22218-aa5f-493f-afac-a715c000cd1b', 'Test_option_3', false),
	('418e7250-b717-4a27-8ced-74048754a379', 'd5a22218-aa5f-493f-afac-a715c000cd1b', 'Test_option_4', true),
	('ce73aa8f-fb12-46df-98f6-b63c7c1df156', '5e5e6bcb-4689-4c4d-a9b2-2ff65fa1796f', 'Test_1', true),
	('98622182-c1f5-4759-adf0-07794f3a0e54', '5e5e6bcb-4689-4c4d-a9b2-2ff65fa1796f', 'Test_2', false),
	('bb695227-add2-4032-9b4f-e99535e3ca91', '5e5e6bcb-4689-4c4d-a9b2-2ff65fa1796f', 'Test_3', false),
	('7e00f031-6033-4a4f-8f70-55f9a7f95bcf', '5e5e6bcb-4689-4c4d-a9b2-2ff65fa1796f', 'Test_4', false),
	('d3ebf006-b837-44ad-8c9a-cae449b3d850', 'a40d8bef-f808-4eb1-bb31-65b1cd36a86f', 'Test 1', true),
	('9f0eb42b-e7e4-49c9-81ef-09daaab27169', 'a40d8bef-f808-4eb1-bb31-65b1cd36a86f', 'Test 2', false),
	('59d3d489-f83e-4ef9-a473-54a632560cc9', 'a40d8bef-f808-4eb1-bb31-65b1cd36a86f', 'Test 3', false),
	('6016e530-ae85-421c-b58e-02d5f895b390', 'a40d8bef-f808-4eb1-bb31-65b1cd36a86f', 'Test 4', false),
	('94328115-21de-4d02-bd40-7f61c783a2e7', '4b7da523-548a-43fd-965c-9721331582db', 'Test 1', false),
	('8851580e-7c54-434c-87ec-d5f737ec23fe', '4b7da523-548a-43fd-965c-9721331582db', 'Test 2', false),
	('5920f173-f995-4e48-b8e4-c0a96e62b209', '4b7da523-548a-43fd-965c-9721331582db', 'Test 3', true),
	('ca6bfeba-e327-4bd5-aad9-263d5f03f369', '4b7da523-548a-43fd-965c-9721331582db', 'Test 4', false);


--
-- Data for Name: sub_lessons; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: progress; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: quiz_assignments; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."quiz_assignments" ("id", "quiz_id", "trainee_id", "assigned_by_id", "created_at") VALUES
	('b072940b-5c07-412f-9c6e-1a8440874e8c', '03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.524494'),
	('19fb4e16-f8ab-4db6-bc6a-3b4c30b6e4f4', '03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.524494'),
	('d770db54-1204-461d-96f0-751a5788bcb1', '6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:45:47.665467'),
	('6a9822d5-9bc1-4ce2-8727-537fcdba4d02', '6ccbe1ab-0b04-4233-a6f1-dfa5d919c260', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:45:47.665467');


--
-- Data for Name: quiz_submissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."quiz_submissions" ("id", "trainee_id", "quiz_id", "score", "submitted_at", "is_reviewed") VALUES
	('6c1375d4-ade2-411e-9991-1468b36d40d7', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', 100, '2025-10-28 09:27:25.524494', false),
	('9cfeab55-1e96-4fcf-8743-6dbae57bcfc3', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '09df3b88-8650-4ec5-8101-3e6ed70f53e6', 50, '2025-10-29 09:01:44.271413', false),
	('5c0592ce-6c61-418b-b30a-9517e590998b', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '03ad5ccc-667a-4468-aedb-2b4fd12fcfc3', 50, '2025-10-28 09:27:25.524494', true);


--
-- Data for Name: quiz_submission_answers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."quiz_submission_answers" ("id", "submission_id", "question_id", "selected_option_id") VALUES
	('a2f2ae2b-74b2-4c1b-8a33-7ead2183f3f8', '6c1375d4-ade2-411e-9991-1468b36d40d7', '151c637f-fe61-4ac8-abbe-fd5eef9536f7', '4e00a2d1-21f2-47b6-b3c3-bc62f940fedd'),
	('f51c5ed3-6d1f-480a-8838-1a9526f393f4', '6c1375d4-ade2-411e-9991-1468b36d40d7', '21375af6-d96d-4d40-94c3-0d194aad8f1c', 'b68de67f-9276-4e87-8c23-bb11443749c9'),
	('a0e59725-d5a9-4fa2-85a5-e91d7b8957d9', '5c0592ce-6c61-418b-b30a-9517e590998b', '151c637f-fe61-4ac8-abbe-fd5eef9536f7', '24627f6f-6ec6-4225-b304-73adf65c6ad2'),
	('472388a4-fc07-4dfb-9841-a7e022994da8', '5c0592ce-6c61-418b-b30a-9517e590998b', '21375af6-d96d-4d40-94c3-0d194aad8f1c', 'ec010d15-84b4-4b7d-9b56-ec06640d4966'),
	('b09bc6a8-d171-44c7-af29-7258cbdac31a', '9cfeab55-1e96-4fcf-8743-6dbae57bcfc3', 'a40d8bef-f808-4eb1-bb31-65b1cd36a86f', 'd3ebf006-b837-44ad-8c9a-cae449b3d850'),
	('7bfcd4b0-1307-432b-86fb-7c4774c9c7ef', '9cfeab55-1e96-4fcf-8743-6dbae57bcfc3', '4b7da523-548a-43fd-965c-9721331582db', '94328115-21de-4d02-bd40-7f61c783a2e7');


--
-- Data for Name: reflections; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."reflections" ("id", "trainee_id", "strengths", "weaknesses", "mes_more", "mes_equal", "is_reviewed", "reviewed_by_id", "created_at") VALUES
	('1e9f0913-c6a4-4403-bc6f-2e30a7fe4491', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'CSS layouts', 'JS basics', 'Practice', 'Focus', true, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.524494'),
	('be2be30f-094c-4bde-99a2-68c67d90e55c', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Test 123', 'Test 123', 'Test  123', 'Test 123', true, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.524494'),
	('7d4ad322-a6da-4ef6-a568-8c0515c3655a', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Test', 'Test', 'Test ', 'Test', false, NULL, '2025-10-28 10:45:19.354722'),
	('b470f318-9c3a-45bb-aae3-f2df2e5edeeb', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Test', 'Test', 'Test ', 'Test', false, NULL, '2025-11-03 12:46:51.689209'),
	('cd8d4a56-8ed6-44eb-8486-119fb6dc46e4', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'Test 1', 'Test  1', 'Test  1', 'Test 1', true, '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-11-03 12:47:51.86794');


--
-- Data for Name: trainee_achieved_skills; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."trainee_achieved_skills" ("id", "trainee_id", "skill_id", "achieved_via_course_id", "achieved_at") VALUES
	('1baa2873-13a2-442a-9eb3-d64c004536a8', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', '18e4fbda-5f89-4ffd-a895-43531365c4b3', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', '2025-10-28 09:27:25.524494'),
	('ce2cd846-46f9-44f4-beea-700e723ea712', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'ce39324f-80bb-4d47-94ca-42f946d8e88e', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', '2025-10-28 09:27:25.524494'),
	('6a7b8171-97e3-49f4-a452-0baf16dd18b1', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '18e4fbda-5f89-4ffd-a895-43531365c4b3', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', '2025-10-28 09:27:25.524494');


--
-- Data for Name: use_cases; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."use_cases" ("id", "course_id", "title", "description_text", "order_index", "duration_value", "duration_unit", "is_active", "created_at", "updated_at", "activated_at") VALUES
	('b0ddc88c-4091-4279-a44b-6dde47f99878', '573810ec-cce8-44d1-a373-48ca11ed0b89', 'test', 'test_Dec', 1, NULL, NULL, true, '2025-10-28 13:01:29.198055', '2025-10-28 13:01:29.198055', NULL),
	('f2bb5471-9b64-40bf-834d-d04a8014a830', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'Responsive Layout Use Case', 'Create a responsive layout with header, grid, and footer.', 2, 1, 'DAYS', true, '2025-10-28 09:27:25.524494', '2025-10-29 08:50:01.934', '2025-10-29 08:50:01.934'),
	('909d27c1-b545-48f6-8bba-e09fadb80a2c', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'test', 'test', 4, 2, 'DAYS', false, '2025-10-29 15:39:25.386228', '2025-10-29 15:50:07.563', '2025-10-29 15:46:07.615'),
	('ba5f702d-275e-4534-bfb2-040b54865bbe', '3ae90667-1a9d-42ac-98f4-2d760f9192bd', 'Forms and Validation', 'Build a form with validation using HTML/CSS/JS.', 3, 1, 'DAYS', true, '2025-10-28 09:27:25.524494', '2025-10-29 15:44:53.295', '2025-10-29 15:44:53.294');


--
-- Data for Name: use_case_submissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."use_case_submissions" ("id", "trainee_id", "use_case_id", "submission_text", "status", "trainer_feedback", "reviewed_by_id", "reviewed_at", "submitted_at") VALUES
	('61c80c06-3723-473e-8317-a9cfc7627604', 'c4fd8987-87ee-443a-aac7-6e7c0808c26d', 'ba5f702d-275e-4534-bfb2-040b54865bbe', 'My solution text', 'APPROVED', 'Good job', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-28 09:27:25.687', '2025-10-28 09:27:25.524494'),
	('0c5d773a-0f8e-41a4-96d1-7bef647bebd0', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', 'ba5f702d-275e-4534-bfb2-040b54865bbe', 'Links attached', 'PENDING', NULL, NULL, NULL, '2025-10-28 09:27:25.524494');


--
-- Data for Name: use_case_submission_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."use_case_submission_links" ("id", "submission_id", "url", "description") VALUES
	('741bfe7b-f123-4dcd-97d8-bef10036f818', '61c80c06-3723-473e-8317-a9cfc7627604', 'https://github.com/example/repo', 'GitHub Repo'),
	('bb615a77-b614-48f5-ad92-e7bfdd4b6249', '0c5d773a-0f8e-41a4-96d1-7bef647bebd0', 'https://1drv.ms/f/mock', 'OneDrive');


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES
	('avatars', 'avatars', NULL, '2025-10-29 12:40:53.084197+00', '2025-10-29 12:40:53.084197+00', true, false, NULL, NULL, NULL, 'STANDARD');


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: iceberg_namespaces; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: iceberg_tables; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

INSERT INTO "storage"."objects" ("id", "bucket_id", "name", "owner", "created_at", "updated_at", "last_accessed_at", "metadata", "version", "owner_id", "user_metadata", "level") VALUES
	('b9d0ac5a-094e-4ded-bd05-605ee19affda', 'avatars', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292/1761742217328_profile.jpg', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-29 12:50:16.991239+00', '2025-10-29 12:50:16.991239+00', '2025-10-29 12:50:16.991239+00', '{"eTag": "\"72be8a6dabe01932af0aec985ad84f20\"", "size": 4622, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-29T12:50:16.944Z", "contentLength": 4622, "httpStatusCode": 200}', '70620a61-7b7f-4f72-80c4-1e9a009e94c0', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '{}', 2),
	('8d0b60b7-08a3-4bfc-8275-b37c119acc6d', 'avatars', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65/1761742652728_profile_1.jpg', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-29 12:57:32.839812+00', '2025-10-29 12:57:32.839812+00', '2025-10-29 12:57:32.839812+00', '{"eTag": "\"5872614e2337b1863865383e7316be32\"", "size": 4258, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-29T12:57:32.817Z", "contentLength": 4258, "httpStatusCode": 200}', '0e176bf1-0b32-4065-8be6-24aa5b47b08e', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '{}', 2);


--
-- Data for Name: prefixes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

INSERT INTO "storage"."prefixes" ("bucket_id", "name", "created_at", "updated_at") VALUES
	('avatars', '4bdfa8e5-91d5-4cbe-9e1c-882a93190292', '2025-10-29 12:50:16.991239+00', '2025-10-29 12:50:16.991239+00'),
	('avatars', '4bf8c2fc-b38f-4ef9-aebb-76eaa2beef65', '2025-10-29 12:57:32.839812+00', '2025-10-29 12:57:32.839812+00');


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: hooks; Type: TABLE DATA; Schema: supabase_functions; Owner: supabase_functions_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 234, true);


--
-- Name: hooks_id_seq; Type: SEQUENCE SET; Schema: supabase_functions; Owner: supabase_functions_admin
--

SELECT pg_catalog.setval('"supabase_functions"."hooks_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict uIdyzIe8CYSE8QKWrhfgqaAj3WbUszHJUnN2S74foSsQqQbpw2Od6HZ7LgVrYiH

RESET ALL;
