terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# PostgreSQL Database (Aurora Serverless v2)
resource "aws_rds_cluster" "kazibet_db" {
  cluster_identifier     = "${var.environment}-kazibet-db"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = "16.1"
  database_name          = "kazibet_${var.environment}"
  master_username        = var.db_master_username
  master_password        = var.db_master_password
  skip_final_snapshot    = var.environment == "sandbox"
  enable_http_endpoint   = true
  deletion_protection    = var.environment == "production"

  serverlessv2_scaling_configuration {
    max_capacity = 16.0
    min_capacity = 0.5
  }
}

# Redis Cluster (ElastiCache)
resource "aws_elasticache_replication_group" "kazibet_redis" {
  replication_group_id       = "${var.environment}-kazibet-cache"
  description                = "KaziBet distributed locks and rate limiting"
  engine                     = "redis"
  node_type                  = "cache.t4g.medium"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}
