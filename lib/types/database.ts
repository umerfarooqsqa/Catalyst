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
          collection: string | null
          source_bug_id: string | null
          source_project_id: string | null
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
          collection?: string | null
          source_bug_id?: string | null
          source_project_id?: string | null
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
          collection?: string | null
          source_bug_id?: string | null
          source_project_id?: string | null
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
          related_warning_id: string | null
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
          related_warning_id?: string | null
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
          related_warning_id?: string | null
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
          added_from_play: boolean
          android_package: string | null
          ios_bundle_id: string | null
          /** Generated from name (migration 0046); unique per platform. Never written. */
          name_key: string
          assigned_developer_id: string | null
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
          added_from_play?: boolean
          android_package?: string | null
          ios_bundle_id?: string | null
          assigned_developer_id?: string | null
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
          added_from_play?: boolean
          android_package?: string | null
          ios_bundle_id?: string | null
          assigned_developer_id?: string | null
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
      play_apps_ignored: {
        Row: { package: string; ignored_at: string; note: string | null }
        Insert: { package: string; ignored_at?: string; note?: string | null }
        Update: { package?: string; ignored_at?: string; note?: string | null }
        Relationships: [
        ]
      }
      play_builds: {
        Row: {
          error: string | null
          min_sdk: number | null
          package: string
          read_at: string
          target_sdk: number | null
          version_code: number
          version_name: string | null
        }
        Insert: {
          error?: string | null
          min_sdk?: number | null
          package: string
          read_at?: string
          target_sdk?: number | null
          version_code: number
          version_name?: string | null
        }
        Update: {
          error?: string | null
          min_sdk?: number | null
          package?: string
          read_at?: string
          target_sdk?: number | null
          version_code?: number
          version_name?: string | null
        }
        Relationships: [
        ]
      }
      play_versions: {
        Row: {
          checked_at: string
          created_at: string
          error: string | null
          live_code: number | null
          live_version: string | null
          package: string
          play_key: string | null
          project_id: string
          reachable: boolean
          snapshot_date: string | null
          upcoming_code: number | null
          upcoming_fraction: number | null
          upcoming_status: string | null
          upcoming_track: string | null
          upcoming_version: string | null
          updated_at: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          error?: string | null
          live_code?: number | null
          live_version?: string | null
          package: string
          play_key?: string | null
          project_id: string
          reachable?: boolean
          snapshot_date?: string | null
          upcoming_code?: number | null
          upcoming_fraction?: number | null
          upcoming_status?: string | null
          upcoming_track?: string | null
          upcoming_version?: string | null
          updated_at?: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          error?: string | null
          live_code?: number | null
          live_version?: string | null
          package?: string
          play_key?: string | null
          project_id?: string
          reachable?: boolean
          snapshot_date?: string | null
          upcoming_code?: number | null
          upcoming_fraction?: number | null
          upcoming_status?: string | null
          upcoming_track?: string | null
          upcoming_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      app_warning_email_prefs: {
        Row: {
          category: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          enabled: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_warnings: {
        Row: {
          action_url: string | null
          active: boolean
          bug_filed_at: string | null
          bug_id: string | null
          cleared_at: string | null
          close_note: string | null
          notified_at: string | null
          closed_at: string | null
          closed_by: string | null
          data: Json
          detail: string | null
          fingerprint: string
          first_seen_at: string
          id: string
          kind: string
          last_seen_at: string
          project_id: string
          reopened_count: number
          severity: "critical" | "warning"
          source: string
          status: "open" | "closed"
          title: string
          updated_at: string
        }
        Insert: {
          action_url?: string | null
          active?: boolean
          bug_filed_at?: string | null
          bug_id?: string | null
          cleared_at?: string | null
          close_note?: string | null
          notified_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          data?: Json
          detail?: string | null
          fingerprint: string
          first_seen_at?: string
          id?: string
          kind: string
          last_seen_at?: string
          project_id: string
          reopened_count?: number
          severity: "critical" | "warning"
          source: string
          status?: "open" | "closed"
          title: string
          updated_at?: string
        }
        Update: {
          action_url?: string | null
          active?: boolean
          bug_filed_at?: string | null
          bug_id?: string | null
          cleared_at?: string | null
          close_note?: string | null
          notified_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          data?: Json
          detail?: string | null
          fingerprint?: string
          first_seen_at?: string
          id?: string
          kind?: string
          last_seen_at?: string
          project_id?: string
          reopened_count?: number
          severity?: "critical" | "warning"
          source?: string
          status?: "open" | "closed"
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_warnings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_warnings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_monitor_checks: {
        Row: {
          attempts: number
          check: "play" | "vitals"
          claimed_at: string | null
          created_at: string
          last_error: string | null
          last_ok_at: string | null
          last_run_at: string | null
          next_due_at: string
          project_id: string
        }
        Insert: {
          attempts?: number
          check: "play" | "vitals"
          claimed_at?: string | null
          created_at?: string
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          next_due_at?: string
          project_id: string
        }
        Update: {
          attempts?: number
          check?: "play" | "vitals"
          claimed_at?: string | null
          created_at?: string
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          next_due_at?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_monitor_checks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      app_monitor_config: {
        Row: {
          anr_limit: number
          crash_limit: number
          device_limit: number
          device_min_users: number
          early_share: number
          enabled: boolean
          id: boolean
          new_crash_min_users: number
          play_minutes: number
          stale_minutes: number
          target_warn_days: number
          updated_at: string
          vitals_minutes: number
          wakelock_limit: number
        }
        Insert: {
          anr_limit?: number
          crash_limit?: number
          device_limit?: number
          device_min_users?: number
          early_share?: number
          enabled?: boolean
          id?: boolean
          new_crash_min_users?: number
          play_minutes?: number
          stale_minutes?: number
          target_warn_days?: number
          updated_at?: string
          vitals_minutes?: number
          wakelock_limit?: number
        }
        Update: {
          anr_limit?: number
          crash_limit?: number
          device_limit?: number
          device_min_users?: number
          early_share?: number
          enabled?: boolean
          id?: boolean
          new_crash_min_users?: number
          play_minutes?: number
          stale_minutes?: number
          target_warn_days?: number
          updated_at?: string
          vitals_minutes?: number
          wakelock_limit?: number
        }
        Relationships: [
        ]
      }
      target_api_rules: {
        Row: {
          applies_to: "updates" | "existing"
          effective_date: string
          extended_to: string | null
          id: string
          min_api: number
          note: string | null
        }
        Insert: {
          applies_to: "updates" | "existing"
          effective_date: string
          extended_to?: string | null
          id?: string
          min_api: number
          note?: string | null
        }
        Update: {
          applies_to?: "updates" | "existing"
          effective_date?: string
          extended_to?: string | null
          id?: string
          min_api?: number
          note?: string | null
        }
        Relationships: [
        ]
      }
      play_keys: {
        Row: {
          apps_checked_at: string | null
          client_email: string
          created_at: string
          created_by: string | null
          gcp_project: string | null
          id: string
          last_error: string | null
          last_ok_at: string | null
          name: string
          vault_secret_id: string
        }
        Insert: {
          apps_checked_at?: string | null
          client_email: string
          created_at?: string
          created_by?: string | null
          gcp_project?: string | null
          id?: string
          last_error?: string | null
          last_ok_at?: string | null
          name: string
          vault_secret_id: string
        }
        Update: {
          apps_checked_at?: string | null
          client_email?: string
          created_at?: string
          created_by?: string | null
          gcp_project?: string | null
          id?: string
          last_error?: string | null
          last_ok_at?: string | null
          name?: string
          vault_secret_id?: string
        }
        Relationships: [
        ]
      }
      play_key_apps: {
        Row: {
          adopt_error: string | null
          adopt_tried_at: string | null
          key_id: string
          package: string
          seen_at: string
        }
        Insert: {
          adopt_error?: string | null
          adopt_tried_at?: string | null
          key_id: string
          package: string
          seen_at?: string
        }
        Update: {
          adopt_error?: string | null
          adopt_tried_at?: string | null
          key_id?: string
          package?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_key_apps_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "play_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      play_emails: {
        Row: {
          created_at: string
          excerpt: string | null
          id: string
          message_id: string
          project_id: string | null
          received_at: string | null
          sender: string | null
          subject: string | null
          thread_id: string | null
          warning_id: string | null
        }
        Insert: {
          created_at?: string
          excerpt?: string | null
          id?: string
          message_id: string
          project_id?: string | null
          received_at?: string | null
          sender?: string | null
          subject?: string | null
          thread_id?: string | null
          warning_id?: string | null
        }
        Update: {
          created_at?: string
          excerpt?: string | null
          id?: string
          message_id?: string
          project_id?: string | null
          received_at?: string | null
          sender?: string | null
          subject?: string | null
          thread_id?: string | null
          warning_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "play_emails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_emails_warning_id_fkey"
            columns: ["warning_id"]
            isOneToOne: false
            referencedRelation: "app_warnings"
            referencedColumns: ["id"]
          },
        ]
      }
      releases: {
        Row: {
          target_sdk: number | null
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
          target_sdk?: number | null
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
          target_sdk?: number | null
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
      role_categories: {
        Row: {
          id: string
          key: string
          label: string
          short_label: string
          description: string | null
          keywords: string[]
          color: string
          all_platforms: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          label: string
          short_label: string
          description?: string | null
          keywords?: string[]
          color?: string
          all_platforms?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          label?: string
          short_label?: string
          description?: string | null
          keywords?: string[]
          color?: string
          all_platforms?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_area_developers: {
        Row: {
          project_id: string
          area: string
          developer_id: string
          created_at: string
        }
        Insert: {
          project_id: string
          area: string
          developer_id: string
          created_at?: string
        }
        Update: {
          project_id?: string
          area?: string
          developer_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_area_developers_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_area_developers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_email_settings: {
        Row: {
          project_id: string
          mode: "instant" | "auto_batch" | "daily_digest"
          batch_size: number
          fallback_hours: number
          fallback_minutes: number
          digest_time: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          project_id: string
          mode?: "instant" | "auto_batch" | "daily_digest"
          batch_size?: number
          fallback_hours?: number
          fallback_minutes?: number
          digest_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          project_id?: string
          mode?: "instant" | "auto_batch" | "daily_digest"
          batch_size?: number
          fallback_hours?: number
          fallback_minutes?: number
          digest_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_email_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          group_key: string
          group_name: string
          project_id: string | null
          mixed: boolean
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          group_key: string
          group_name: string
          project_id?: string | null
          mixed?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          group_key?: string
          group_name?: string
          project_id?: string | null
          mixed?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_scan_requests: {
        Row: {
          id: string
          scope: "all_groups"
          since: string
          status: "pending" | "seen" | "done" | "cancelled" | "expired"
          requested_by: string | null
          requested_at: string
          seen_at: string | null
          completed_at: string | null
          rows_received: number
          note: string | null
          notified_at: string | null
          notify_error: string | null
        }
        Insert: {
          id?: string
          scope?: "all_groups"
          since: string
          status?: "pending" | "seen" | "done" | "cancelled" | "expired"
          requested_by?: string | null
          requested_at?: string
          seen_at?: string | null
          completed_at?: string | null
          rows_received?: number
          note?: string | null
          notified_at?: string | null
          notify_error?: string | null
        }
        Update: {
          id?: string
          scope?: "all_groups"
          since?: string
          status?: "pending" | "seen" | "done" | "cancelled" | "expired"
          requested_by?: string | null
          requested_at?: string
          seen_at?: string | null
          completed_at?: string | null
          rows_received?: number
          note?: string | null
          notified_at?: string | null
          notify_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_scan_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_items: {
        Row: {
          item_id: string
          kind: "bug" | "task"
          project_id: string | null
          bug_id: string | null
          task_id: string | null
          whatsapp_group: string | null
          imported_at: string
          imported_by: string | null
        }
        Insert: {
          item_id: string
          kind: "bug" | "task"
          project_id?: string | null
          bug_id?: string | null
          task_id?: string | null
          whatsapp_group?: string | null
          imported_at?: string
          imported_by?: string | null
        }
        Update: {
          item_id?: string
          kind?: "bug" | "task"
          project_id?: string | null
          bug_id?: string | null
          task_id?: string | null
          whatsapp_group?: string | null
          imported_at?: string
          imported_by?: string | null
        }
        Relationships: []
      }
      notification_emails: {
        Row: {
          user_id: string
          email: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          user_id: string
          email: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          user_id?: string
          email?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_emails_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_opt_outs: {
        Row: {
          user_id: string
          event_type: "all" | "assignment" | "status_change" | "comment" | "retest_ready"
          created_at: string
        }
        Insert: {
          user_id: string
          event_type: "all" | "assignment" | "status_change" | "comment" | "retest_ready"
          created_at?: string
        }
        Update: {
          user_id?: string
          event_type?: "all" | "assignment" | "status_change" | "comment" | "retest_ready"
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_opt_outs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          area: string | null
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
          area?: string | null
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
          area?: string | null
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
      app_warnings_sync: {
        Args: { p_project: string; p_source: string; p_items: Json; p_clear?: boolean }
        Returns: Json
      }
      app_warning_close: { Args: { p_id: string; p_note?: string | null }; Returns: undefined }
      play_mail_unmatched_notify: { Args: { p_subject: string }; Returns: undefined }
      play_app_claim: { Args: Record<string, never>; Returns: { package: string; key_id: string }[] }
      play_app_adopt: { Args: { p_package: string; p_title: string }; Returns: string }
      monitor_claim: {
        Args: { p_limit?: number }
        Returns: {
          project_id: string
          check: string
          project_name: string
          package: string
          current_version: string | null
          house_slug: string | null
          last_ok_at: string | null
        }[]
      }
      monitor_done: {
        Args: { p_project: string; p_check: string; p_ok: boolean; p_error?: string | null }
        Returns: undefined
      }
      monitor_request: { Args: { p_project: string }; Returns: undefined }
      monitor_setting: { Args: { p_key: string }; Returns: string }
      app_monitor_kick: { Args: never; Returns: undefined }
      play_key_put: { Args: { p_name: string; p_key: Json }; Returns: string }
      play_key_delete: { Args: { p_id: string }; Returns: undefined }
      play_key_secret: { Args: { p_id: string }; Returns: Json }
      play_mail_setup: { Args: never; Returns: Json }
      in_app_health: { Args: never; Returns: boolean }
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
      email_stats: {
        Args: { p_project?: string | null }
        Returns: {
          sent_today: number
          daily_limit: number
          queued: number
          pending_bugs: number
          pending_people: number
          project_pending_bugs: number
        }[]
      }
      email_claim: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          recipient_id: string | null
          recipient_email: string
          kind: "instant" | "critical" | "batch" | "digest"
          priority: number
          items: Json
          status: "queued" | "sending" | "sent" | "failed"
          attempts: number
          last_error: string | null
          send_after: string
          claimed_at: string | null
          sent_at: string | null
          created_at: string
        }[]
      }
      email_mark: {
        Args: { p_id: string; p_ok: boolean; p_error?: string | null; p_final?: boolean }
        Returns: undefined
      }
      email_sweep: { Args: never; Returns: number }
      whatsapp_import: {
        Args: { p_rows: Json; p_create_projects?: boolean; p_dry_run?: boolean }
        Returns: Json
      }
      whatsapp_inbox_upsert: { Args: { p_rows: Json }; Returns: Json }
      whatsapp_inbox_status: { Args: never; Returns: Json }
      whatsapp_auto_import: { Args: never; Returns: Json }
      whatsapp_inbox_dismiss: { Args: { p_item_ids: string[] }; Returns: number }
      team_activity: {
        Args: { p_days?: number }
        Returns: {
          person_id: string
          full_name: string
          day: string
          kind: "bug" | "task"
          assigned: number
          completed: number
        }[]
      }
      whatsapp_inbox_set_sender: { Args: { p_item_ids: string[]; p_sender: string }; Returns: number }
      whatsapp_request_scan: {
        Args: never
        Returns: Database["public"]["Tables"]["whatsapp_scan_requests"]["Row"]
      }
      whatsapp_cancel_scan: { Args: { p_id: string }; Returns: boolean }
      whatsapp_scan_pending: { Args: never; Returns: Json }
      whatsapp_scan_notified: { Args: { p_id: string; p_error: string | null }; Returns: undefined }
      whatsapp_scan_report: {
        Args: { p_id: string; p_rows: number; p_note: string | null; p_done: boolean }
        Returns: Json
      }
      whatsapp_set_group: {
        Args: { p_group: string; p_project: string | null; p_mixed?: boolean }
        Returns: Json
      }
      whatsapp_inbox_waiting: {
        Args: never
        Returns: {
          item_id: string
          row: Json
          status: "new" | "skipped" | "dismissed"
          received_count: number
          first_received_at: string
          last_received_at: string
        }[]
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
        | "app_warning"
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
        "app_warning",
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
