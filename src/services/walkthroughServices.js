import { list, create, watch, update, currentUser, OpenShiftWatchEvents } from './openshiftServices';
import { walkthroughTypes } from '../redux/constants';
import { FULFILLED_ACTION } from '../redux/helpers';
import { buildServiceInstanceResourceObj, DEFAULT_SERVICES } from './serviceInstanceServices';

const WALKTHROUGH_SERVICES = Object.values(DEFAULT_SERVICES);

const mockUserWalkthrough = (dispatch, mockData) => {
  if (!mockData || !mockData.serviceInstances) {
    return;
  }
  mockData.serviceInstances.forEach(si =>
    dispatch({
      type: FULFILLED_ACTION(walkthroughTypes.CREATE_WALKTHROUGH),
      payload: si
    })
  );
};

const manageUserWalkthrough = dispatch => {
  currentUser().then(user => {
    const userNamespace = buildValidProjectNamespaceName(user.username);

    const namespaceRequestResourceDef = {
      name: 'projectrequests',
      version: 'v1',
      group: 'project.openshift.io'
    };
    const namespaceResourceDef = {
      name: 'projects',
      version: 'v1',
      group: 'project.openshift.io'
    };
    const namespaceObj = {
      kind: 'ProjectRequest',
      metadata: {
        name: userNamespace
      }
    };
    const statefulSetDef = {
      name: 'statefulsets',
      group: 'apps',
      version: 'v1beta1',
      namespace: userNamespace
    }

    findOpenshiftResource(namespaceResourceDef, namespaceObj)
      .then(foundResource => {
        if (!foundResource) {
          return create(namespaceRequestResourceDef, namespaceObj);
        }
        return foundResource;
      })
      .then(() => {
        const siObjs = WALKTHROUGH_SERVICES.map(name =>
          buildServiceInstanceResourceObj({ namespace: userNamespace, name, user })
        );
        return Promise.all(
          siObjs.map(siObj =>
            findOrCreateOpenshiftResource(
              buildServiceInstanceDef(userNamespace),
              siObj,
              resObj => resObj.spec.clusterServiceClassExternalName === siObj.spec.clusterServiceClassExternalName
            )
          )
        );
      })
      .then(() => {
        watch(buildServiceInstanceDef(userNamespace)).then(watchListener =>
          watchListener.onEvent(handleServiceInstanceWatchEvents.bind(null, dispatch))
        );
        watch(statefulSetDef).then(watchListener => watchListener.onEvent(handleAMQStatefulSetWatchEvents.bind(null, userNamespace)));
      });
  });
};

const buildRouteDef = namespace => ({
  name: 'routes',
  group: 'route.openshift.io',
  version: 'v1',
  namespace: namespace
})

const buildServiceInstanceDef = namespace => ({
  name: 'serviceinstances',
  namespace: namespace,
  version: 'v1beta1',
  group: 'servicecatalog.k8s.io'
})

const handleAMQStatefulSetWatchEvents = (namespace, event) => {
  if (event.type === OpenShiftWatchEvents.OPENED || event.type === OpenShiftWatchEvents.CLOSED || event.type === OpenShiftWatchEvents.DELETED) {
    return;
  }
  const sSet = event.payload;
  if (!sSet.spec || !sSet.spec.template || !sSet.spec.template.spec || !sSet.spec.template.spec.containers || !sSet.spec.template.spec.containers[0]) {
    return;
  }
  const specContainer = sSet.spec.template.spec.containers[0];
  if (!specContainer.env) {
    return;
  }

  const usernameEnv = specContainer.env.find(e => e.name === 'AMQ_USER');
  const passwordEnv = specContainer.env.find(e => e.name === 'AMQ_PASSWORD');
  if (!usernameEnv.value || !passwordEnv.value) {
    return;
  }

  const secretDef = {
    name: 'secrets',
    version: 'v1',
    namespace: namespace
  }
  const secretRes = {
    metadata: {
      name: 'amq-broker-credentials'
    },
    stringData: {
      username: usernameEnv.value,
      password: passwordEnv.value
    }
  }
  replaceOpenShiftResource(secretDef, secretRes, secret => {
    if (!secret || !secret.data) {
      return false;
    }
    return secret.data.username !== window.btoa(usernameEnv.value) || secret.data.password !== window.btoa(passwordEnv.value);
  });
}

const handleServiceInstanceWatchEvents = (dispatch, event) => {
  if (event.type === OpenShiftWatchEvents.OPENED || event.type === OpenShiftWatchEvents.CLOSED) {
    return;
  }

  if (!WALKTHROUGH_SERVICES.includes(event.payload.spec.clusterServiceClassExternalName)) {
    return;
  }
  if (event.type === OpenShiftWatchEvents.ADDED || event.type === OpenShiftWatchEvents.MODIFIED) {
    dispatch({
      type: FULFILLED_ACTION(walkthroughTypes.CREATE_WALKTHROUGH),
      payload: event.payload
    });

    // We know that the AMQ ServiceInstance will not have a dashboardURL associated with it.
    // The reason for this is that the Template Service Broker doesn't allow for dashboardURLs.
    // Because of this, for AMQ, we need to set an annotation on the ServiceInstance with
    // the route specified there instead.
    const dashboardUrl = 'integreatly/dashboard-url';
    if (event.payload.metadata.annotations && event.payload.metadata.annotations[dashboardUrl]) {
      return;
    }
    const routeResource = {
      metadata: {
        name: 'console'
      }
    }
    findOpenshiftResource(buildRouteDef(event.payload.metadata.namespace), routeResource)
      .then(route => {
        if (!route) {
          return;
        }
        if (!event.payload.metadata.annotations) {
          event.payload.metadata.annotations = {};
        }
        event.payload.metadata.annotations[dashboardUrl] = `http://${route.spec.host}`;
        update(buildServiceInstanceDef(event.payload.metadata.namespace), event.payload);
      });
  }
  if (event.type === OpenShiftWatchEvents.DELETED) {
    dispatch({
      type: FULFILLED_ACTION(walkthroughTypes.REMOVE_WALKTHROUGH),
      payload: event.payload
    });
  }
};

const findOpenshiftResource = (openshiftResourceDef, resToFind, compareFn = (resObj => resObj.metadata.name === resToFind.metadata.name)) =>
  list(openshiftResourceDef)
    .then(listResponse => listResponse && listResponse.items ? listResponse.items : [])
    .then(resourceObjs => {
      return resourceObjs.find(resObj => compareFn(resObj));
    });

const findOrCreateOpenshiftResource = (openshiftResourceDef, resToFind, compareFn) =>
  findOpenshiftResource(openshiftResourceDef, resToFind, compareFn).then(foundResource => {
    if (!foundResource) {
      return create(openshiftResourceDef, resToFind);
    }
    return Promise.resolve(foundResource);
  });

const replaceOpenShiftResource = (resourceDef, resourceRes, replaceIfFn = (resObj => resObj.metadata.name === resourceRes.metadata.name)) =>
  findOrCreateOpenshiftResource(resourceDef, resourceRes)
    .then(resource => {
      if (replaceIfFn(resource)) {
        return update(resourceDef, resourceRes);
      }
      return Promise.resolve(resource);
    });

const buildValidProjectNamespaceName = username => `${cleanUsername(username)}-walkthrough-projects`;

const cleanUsername = username => username.replace(/@/g, '-').replace(/\./g, '-');

export { manageUserWalkthrough, mockUserWalkthrough };
