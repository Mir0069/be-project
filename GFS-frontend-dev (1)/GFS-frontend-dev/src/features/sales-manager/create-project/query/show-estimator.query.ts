import {

  useQuery

}

  from "@tanstack/react-query";

import {

  getEstimators

}

  from "@/services/show-estimator";


export const useEstimators =

  () =>

    useQuery({

      queryKey: [
        "estimators"
      ],

      queryFn:
        getEstimators

    });