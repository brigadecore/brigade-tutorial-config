CONTEXT ?= docker-for-desktop
COMMIT ?= $(shell git rev-parse HEAD)
REF ?= $(shell git branch | grep \* | cut -d ' ' -f2)
ENV_NAME ?= bob

# Set GitHub Auth Token and Webhook Shared Secret here
GITHUB_TOKEN ?= ""
GITHUB_SHARED_SECRET ?= ""

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
		-f projects/$$project/values.yaml; \
	done


create-environment:
	yarn build
	brig run -c $(COMMIT) -r $(REF) -f brigade.js kooba/brigade-tutorial-config \
	--kube-context $(CONTEXT) --namespace brigade
