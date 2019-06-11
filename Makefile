CONTEXT ?= docker-for-desktop
COMMIT ?= $(shell git rev-parse HEAD)
REF ?= $(shell git branch | grep \* | cut -d ' ' -f2)
ENV_NAME ?= bob

# Set GitHub Auth Token and Webhook Shared Secret here
GITHUB_TOKEN ?= ""
GITHUB_SHARED_SECRET ?= ""

configure-helm:
	kubectl --context=$(CONTEXT) create serviceaccount --namespace kube-system tiller
	kubectl --context=$(CONTEXT) create clusterrolebinding tiller-cluster-rule \
	--clusterrole=cluster-admin --serviceaccount=kube-system:tiller
	helm --kube-context=$(CONTEXT) init --service-account tiller

brigade-namespace:
	kubectl --context=$(CONTEXT) apply -f namespace.yaml

deploy-brigade:
	helm repo add brigade https://brigadecore.github.io/charts --kube-context=$(CONTEXT)
	helm upgrade brigade brigade/brigade \
	--install \
	--namespace brigade  \
	--kube-context=$(CONTEXT) \
	--set vacuum.age=72h \
	--set vacuum.maxBuilds=10 \
	--set brigade-github-app.enabled=true
	kubectl --context=$(CONTEXT) create clusterrolebinding brigade-worker-cluster-role \
	--clusterrole=cluster-admin --serviceaccount=brigade:brigade-worker

deploy-projects:
	helm repo add brigade https://brigadecore.github.io/charts --kube-context=$(CONTEXT)
	for project in $(shell ls projects) ; do \
		helm upgrade brigade-$$project brigade/brigade-project \
		--install \
		--namespace brigade \
		--kube-context $(CONTEXT) \
		--set sharedSecret=$(GITHUB_SHARED_SECRET) \
		--set github.token=$(GITHUB_TOKEN) \
		--set worker.tag=v1.0.0 \
		-f projects/$$project/values.yaml; \
	done

create-environment:
	cat payload.tmpl | jq '.name = "$(ENV_NAME)" | .action = "create"' > payload.json
	brig run brigadecore/brigade-tutorial-config -c $(COMMIT) -r $(REF) -f brigade.js \
	-p payload.json --kube-context $(CONTEXT) --namespace brigade
