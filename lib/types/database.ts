// Generated types for the Catalyst Supabase database.
// Regenerate with:
//   supabase gen types typescript --project-id axlvyftdvwpxmlnglsvs > lib/types/database.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          bug_id: string | null
          created_at: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          task_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          bug_id?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          task_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          bug_id?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          task_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_bug_id_fkey"
            columns: ["bug_id"]
            isOneToOne: false
            referencedRelation: "bugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json | null
          created_at: string
          entity_id: string
          entity_label: string | null
          entity_type: string
          id: string
          project_id: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id: string
          entity_label?: string | null
          entity_type: string
          id?: string
          project_id?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string
          entity_label?: string | null
          entity_type?: string
          id?: string
          project_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_reports: {
        Row: {
          cost_usd: number | null
          created_at: string
          excel_path: string | null
          files: Json
          finished_at: string | null
          id: string
          platform: string | null
          project_id: string
          release_id: string | null
          report: Json
          run_id: string
          runner: string | null
          started_at: string | null
          status: string
          summary: Json
          updated_at: string
          version: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          excel_path?: string | null
          files?: Json
          finished_at?: string | null
          id?: string
          platform?: string | null
          project_id: string
          release_id?: string | null
          report?: Json
          run_id: string
          runner?: string | null
          started_at?: string | null
          status?: string
          summary?: Json
          updated_at?: string
          version?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          excel_path?: string | null
          files?: Json
          finished_at?: string | null
          id?: string
          platform?: string | null
          project_id?: string
          release_id?: string | null
          report?: Json
          run_id?: string
          runner?: string | null
          started_at?: string | null
          status?: string
          summary?: Json
          updated_at?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_reports_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          broken: number
          created_at: string
          excel_report_path: string | null
          failed: number
          finished_at: string | null
          id: string
          passed: number
          release_id: string
          run_id: string
          skipped: number
          started_at: string | null
          suite: string
          test_results: Json
        }
        Insert: {
          broken?: number
          created_at?: string
          excel_report_path?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          passed?: number
          release_id: string
          run_id: string
          skipped?: number
          started_at?: string | null
          suite?: string
          test_results?: Json
        }
        Update: {
          broken?: number
          created_at?: string
          excel_report_path?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          passed?: number
          release_id?: string
          run_id?: string
          skipped?: number
          started_at?: string | null
          suite?: string
          test_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      base_page: {
        Row: {
          house_slug: string | null
          platform: string | null
          recurring_count: number
          category_id: string | null
          area: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          last_reused_at: string | null
          project_id: string | null
          requirement_document_id: string | null
          severity: Database["public"]["Enums"]["bug_severity"]
          source_type: Database["public"]["Enums"]["base_page_source"]
          steps_to_reproduce: string | null
          tags: string[] | null
          times_reused: number
          title: string
          updated_at: string
        }
        Insert: {
          house_slug?: string | null
          platform?: string | null
          recurring_count?: number
          category_id?: string | null
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_reused_at?: string | null
          project_id?: string | null
          requirement_document_id?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"]
          source_type?: Database["public"]["Enums"]["base_page_source"]
          steps_to_reproduce?: string | null
          tags?: string[] | null
          times_reused?: number
          title: string
          updated_at?: string
        }
        Update: {
          house_slug?: string | null
          platform?: string | null
          recurring_count?: number
          category_id?: string | null
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_reused_at?: string | null
          project_id?: string | null
          requirement_document_id?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"]
          source_type?: Database["public"]["Enums"]["base_page_source"]
          steps_to_reproduce?: string | null
          tags?: string[] | null
          times_reused?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "base_page_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "bug_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "base_page_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "base_page_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "base_page_requirement_document_id_fkey"
            columns: ["requirement_document_id"]
            isOneToOne: false
            referencedRelation: "requirement_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_categories: {
        Row: {
          created_at: string
          default_area: string | null
          default_severity: Database["public"]["Enums"]["bug_severity"] | null
          id: string
          keyword_hints: string[] | null
          name: string
          template_steps: string | null
        }
        Insert: {
          created_at?: string
          default_area?: string | null
          default_severity?: Database["public"]["Enums"]["bug_severity"] | null
          id?: string
          keyword_hints?: string[] | null
          name: string
          template_steps?: string | null
        }
        Update: {
          created_at?: string
          default_area?: string | null
          default_severity?: Database["public"]["Enums"]["bug_severity"] | null
          id?: string
          keyword_hints?: string[] | null
          name?: string
          template_steps?: string | null
        }
        Relationships: []
      }
      bugs: {
        Row: {
          automation_key: string | null
          occurrences: number
          recurring: boolean
          release_id: string | null
          source: string
          assignee_id: string | null
          base_page_id: string | null
          category_id: string | null
          area: string | null
          closed_at: string | null
          copied_from_bug_id: string | null
          created_at: string
          created_by: string | null
          delegated_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["bug_priority"]
          project_id: string
          requirement_id: string | null
          severity: Database["public"]["Enums"]["bug_severity"]
          status: Database["public"]["Enums"]["bug_status"]
          steps_to_reproduce: string | null
          title: string
          updated_at: string
          version_confirmed_at: string | null
          version_confirmed_by: string | null
        }
        Insert: {
          automation_key?: string | null
          occurrences?: number
          recurring?: boolean
          release_id?: string | null
          source?: string
          assignee_id?: string | null
          base_page_id?: string | null
          category_id?: string | null
          area?: string | null
          closed_at?: string | null
          copied_from_bug_id?: string | null
          created_at?: string
          created_by?: string | null
          delegated_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["bug_priority"]
          project_id: string
          requirement_id?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"]
          status?: Database["public"]["Enums"]["bug_status"]
          steps_to_reproduce?: string | null
          title: string
          updated_at?: string
          version_confirmed_at?: string | null
          version_confirmed_by?: string | null
        }
        Update: {
          automation_key?: string | null
          occurrences?: number
          recurring?: boolean
          release_id?: string | null
          source?: string
          assignee_id?: string | null
          base_page_id?: string | null
          category_id?: string | null
          area?: string | null
          closed_at?: string | null
          copied_from_bug_id?: string | null
          created_at?: string
          created_by?: string | null
          delegated_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["bug_priority"]
          project_id?: string
          requirement_id?: string | null
          severity?: Database["public"]["Enums"]["bug_severity"]
          status?: Database["public"]["Enums"]["bug_status"]
          steps_to_reproduce?: string | null
          title?: string
          updated_at?: string
          version_confirmed_at?: string | null
          version_confirmed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bugs_delegated_by_fkey"
            columns: ["delegated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_base_page_id_fkey"
            columns: ["base_page_id"]
            isOneToOne: false
            referencedRelation: "base_page"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "bug_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_copied_from_bug_id_fkey"
            columns: ["copied_from_bug_id"]
            isOneToOne: false
            referencedRelation: "bugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_version_confirmed_by_fkey"
            columns: ["version_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bugs_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          bug_id: string | null
          content: string
          created_at: string
          edited_at: string | null
          id: string
          task_id: string | null
        }
        Insert: {
          author_id?: string | null
          bug_id?: string | null
          content: string
          created_at?: string
          edited_at?: string | null
          id?: string
          task_id?: string | null
        }
        Update: {
          author_id?: string | null
          bug_id?: string | null
          content?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_bug_id_fkey"
            columns: ["bug_id"]
            isOneToOne: false
            referencedRelation: "bugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          related_bug_id: string | null
          related_task_id: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          related_bug_id?: string | null
          related_task_id?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          related_bug_id?: string | null
          related_task_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_bug_id_fkey"
            columns: ["related_bug_id"]
            isOneToOne: false
            referencedRelation: "bugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          dev_rank: string | null
          email: string
          full_name: string
          id: string
          role: string
          skills: string[]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          dev_rank?: string | null
          email: string
          full_name: string
          id: string
          role?: string
          skills?: string[]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          dev_rank?: string | null
          email?: string
          full_name?: string
          id?: string
          role?: string
          skills?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      project_members: {
        Row: {
          added_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          assigned_developer_id: string | null
          frontend_developer_id: string | null
          backend_developer_id: string | null
          database_developer_id: string | null
          devops_developer_id: string | null
          notify_emails: string[]
          created_at: string
          created_by: string | null
          current_version: string | null
          description: string | null
          house_group: string | null
          house_slug: string | null
          id: string
          name: string
          platform: string | null
          release_notes_ref: string | null
          updated_at: string
        }
        Insert: {
          assigned_developer_id?: string | null
          frontend_developer_id?: string | null
          backend_developer_id?: string | null
          database_developer_id?: string | null
          devops_developer_id?: string | null
          notify_emails?: string[]
          created_at?: string
          created_by?: string | null
          current_version?: string | null
          description?: string | null
          house_group?: string | null
          house_slug?: string | null
          id?: string
          name: string
          platform?: string | null
          release_notes_ref?: string | null
          updated_at?: string
        }
        Update: {
          assigned_developer_id?: string | null
          frontend_developer_id?: string | null
          backend_developer_id?: string | null
          database_developer_id?: string | null
          devops_developer_id?: string | null
          notify_emails?: string[]
          created_at?: string
          created_by?: string | null
          current_version?: string | null
          description?: string | null
          house_group?: string | null
          house_slug?: string | null
          id?: string
          name?: string
          platform?: string | null
          release_notes_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runners: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          last_seen_at: string
          name: string
          os: string
          platform: string
          status: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          name: string
          os: string
          platform: string
          status?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          name?: string
          os?: string
          platform?: string
          status?: string
        }
        Relationships: []
      }
      test_jobs: {
        Row: {
          bug_id: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          generated_tests: Json
          id: string
          kind: string
          note: string | null
          platform: string
          project_id: string
          runner_id: string | null
          status: string
        }
        Insert: {
          bug_id?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          generated_tests?: Json
          id?: string
          kind?: string
          note?: string | null
          platform: string
          project_id: string
          runner_id?: string | null
          status?: string
        }
        Update: {
          bug_id?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          generated_tests?: Json
          id?: string
          kind?: string
          note?: string | null
          platform?: string
          project_id?: string
          runner_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_jobs_bug_id_fkey"
            columns: ["bug_id"]
            isOneToOne: false
            referencedRelation: "bugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_jobs_runner_id_fkey"
            columns: ["runner_id"]
            isOneToOne: false
            referencedRelation: "automation_runners"
            referencedColumns: ["id"]
          },
        ]
      }
      project_automation: {
        Row: {
          folder: string
          last_run_at: string | null
          last_synced_at: string
          project_id: string
          runner_name: string | null
          tests_approved: number
          tests_pending: number
          tests_total: number
        }
        Insert: {
          folder: string
          last_run_at?: string | null
          last_synced_at?: string
          project_id: string
          runner_name?: string | null
          tests_approved?: number
          tests_pending?: number
          tests_total?: number
        }
        Update: {
          folder?: string
          last_run_at?: string | null
          last_synced_at?: string
          project_id?: string
          runner_name?: string | null
          tests_approved?: number
          tests_pending?: number
          tests_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_automation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      releases: {
        Row: {
          claimed_bugs: Json
          completed_at: string | null
          discrepancies: Json
          id: string
          notify_emails: string[]
          project_id: string
          release_notes_ref: string | null
          started_at: string
          status: string
          version: string
        }
        Insert: {
          claimed_bugs?: Json
          completed_at?: string | null
          discrepancies?: Json
          id?: string
          notify_emails?: string[]
          project_id: string
          release_notes_ref?: string | null
          started_at?: string
          status?: string
          version: string
        }
        Update: {
          claimed_bugs?: Json
          completed_at?: string | null
          discrepancies?: Json
          id?: string
          notify_emails?: string[]
          project_id?: string
          release_notes_ref?: string | null
          started_at?: string
          status?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "releases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      requirement_documents: {
        Row: {
          created_at: string
          error_message: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          project_id: string
          requirements_extracted: number
          status: Database["public"]["Enums"]["requirement_doc_status"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          project_id: string
          requirements_extracted?: number
          status?: Database["public"]["Enums"]["requirement_doc_status"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          project_id?: string
          requirements_extracted?: number
          status?: Database["public"]["Enums"]["requirement_doc_status"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requirement_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      requirements: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          project_id: string
          status: Database["public"]["Enums"]["requirement_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          project_id: string
          status?: Database["public"]["Enums"]["requirement_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["requirement_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          assignable: boolean
          created_at: string
          id: string
          is_default: boolean
          key: string
          label: string
          level: string
          platform: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          assignable?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          key: string
          label: string
          level: string
          platform?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          assignable?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          key?: string
          label?: string
          level?: string
          platform?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      task_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          from_value: string | null
          id: string
          task_id: string
          to_value: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          from_value?: string | null
          id?: string
          task_id: string
          to_value?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          from_value?: string | null
          id?: string
          task_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_audit_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          delegated_by: string | null
          description: string | null
          due_date: string | null
          id: string
          linked_bug_id: string | null
          priority: Database["public"]["Enums"]["bug_priority"]
          project_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          delegated_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          linked_bug_id?: string | null
          priority?: Database["public"]["Enums"]["bug_priority"]
          project_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          delegated_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          linked_bug_id?: string | null
          priority?: Database["public"]["Enums"]["bug_priority"]
          project_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_delegated_by_fkey"
            columns: ["delegated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_linked_bug_id_fkey"
            columns: ["linked_bug_id"]
            isOneToOne: false
            referencedRelation: "bugs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_cases: {
        Row: {
          actual_result: string | null
          created_at: string
          created_by: string | null
          expected_result: string | null
          id: string
          requirement_id: string
          status: Database["public"]["Enums"]["test_case_status"]
          steps: string | null
          title: string
          updated_at: string
        }
        Insert: {
          actual_result?: string | null
          created_at?: string
          created_by?: string | null
          expected_result?: string | null
          id?: string
          requirement_id: string
          status?: Database["public"]["Enums"]["test_case_status"]
          steps?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          actual_result?: string | null
          created_at?: string
          created_by?: string | null
          expected_result?: string | null
          id?: string
          requirement_id?: string
          status?: Database["public"]["Enums"]["test_case_status"]
          steps?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_cases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_cases_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_project_developer: { Args: { p_project: string; p_developer: string | null; p_area?: string | null }; Returns: number }
      profile_platform: { Args: { p_user: string }; Returns: string }
      user_platform: { Args: never; Returns: string }
      can_see_project: { Args: { p_project: string }; Returns: boolean }
      can_see_bug: { Args: { p_bug: string }; Returns: boolean }
      can_see_task: { Args: { p_task: string }; Returns: boolean }
      claim_test_job: {
        Args: { p_platform: string; p_runner_id: string }
        Returns: Database["public"]["Tables"]["test_jobs"]["Row"][]
      }
      is_admin: { Args: never; Returns: boolean }
      is_qa_or_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_viewer: { Args: never; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      base_page_source: "master_bug" | "client_requirement"
      bug_priority: "high" | "medium" | "low"
      bug_severity: "critical" | "major" | "minor" | "trivial"
      bug_status:
        | "open"
        | "in_progress"
        | "fixed"
        | "ready_for_retest"
        | "reopened"
        | "closed"
      notification_type:
        | "assignment"
        | "status_change"
        | "comment"
        | "sla_breach"
        | "retest_ready"
      requirement_doc_status: "pending" | "processing" | "completed" | "failed"
      requirement_status: "draft" | "active" | "deprecated"
      task_status:
        | "todo"
        | "in_progress"
        | "blocked"
        | "pending_approval"
        | "done"
      test_case_status: "pending" | "pass" | "fail"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      base_page_source: ["master_bug", "client_requirement"],
      bug_priority: ["high", "medium", "low"],
      bug_severity: ["critical", "major", "minor", "trivial"],
      bug_status: [
        "open",
        "in_progress",
        "fixed",
        "ready_for_retest",
        "reopened",
        "closed",
      ],
      notification_type: [
        "assignment",
        "status_change",
        "comment",
        "sla_breach",
        "retest_ready",
      ],
      requirement_doc_status: ["pending", "processing", "completed", "failed"],
      requirement_status: ["draft", "active", "deprecated"],
      task_status: [
        "todo",
        "in_progress",
        "blocked",
        "pending_approval",
        "done",
      ],
      test_case_status: ["pending", "pass", "fail"],
    },
  },
} as const
