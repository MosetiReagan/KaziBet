variable "aws_region" {
  type        = string
  default     = "af-south-1" # Cape Town (Africa)
  description = "AWS deployment region"
}

variable "environment" {
  type        = string
  default     = "sandbox"
  description = "Environment identifier (sandbox, staging, production)"
}

variable "db_master_username" {
  type        = string
  default     = "kazibet_admin"
  description = "PostgreSQL cluster master username"
}

variable "db_master_password" {
  type        = string
  sensitive   = true
  description = "PostgreSQL cluster master password"
}
