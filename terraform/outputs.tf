output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "github_actions_user_name" {
  value = module.iam.user_name
}
